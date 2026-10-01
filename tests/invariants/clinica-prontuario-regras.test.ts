import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONTACT_1,
  GOV_CONTACT_2,
  GOV_MANAGER,
  GOV_ORG,
  lastLine,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * AS REGRAS CLÍNICAS DO PRONTUÁRIO MORAM NO BANCO (migration 9001, fork TOQ).
 *
 * O PostgREST fala com o JWT da sessão direto, sem rota nenhuma, e o baseline dá GRANT ALL a
 * `authenticated`. Então "só profissional lê", "assinado não muda" e "a assinatura é de quem
 * está logado" só valem se a RLS e os gatilhos disserem — a tela não protege nada sozinha.
 *
 * Elenco (usuários do seedGov):
 *   GOV_AGENT_A  fisioterapeuta ATIVO (fisioterapia, pilates)
 *   GOV_AGENT_B  profissional INATIVO (saiu da clínica)
 *   GOV_MANAGER  recepção/gestão: papel alto, sem cadastro de profissional
 *   GOV_ADMIN    admin da organização, sem cadastro de profissional
 */
const ORG_B = "cccccccc-9001-4000-8000-0000000000b0";
const CONTATO_B = "cccccccc-9001-4000-8000-0000000000b1";
const REG_A = "cccccccc-9001-4000-8000-000000000a01";
const REG_B = "cccccccc-9001-4000-8000-000000000b01";
const ATOR_SUPORTE = "cccccccc-9001-4000-8000-0000000000f1";
const SESSAO_SUPORTE = "cccccccc-9001-4000-8000-0000000000f2";
const COMPROMISSO_OUTRO = "cccccccc-9001-4000-8000-0000000000c1";

/** Executa como `authenticated` com o JWT do usuário; devolve o erro do Postgres ou "" se passou. */
function erroComo(userId: string, comando: string): string {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${comando};
    `);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

/** Executa como o dono (por fora da RLS, como o service_role faria); devolve o erro ou "". */
function erroComoDono(comando: string): string {
  try {
    sql(`${comando};`);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

/** O último número que o psql imprimiu (ignora as tags BEGIN/ROLLBACK). */
function ultimoNumero(saida: string): string {
  return (
    saida
      .split("\n")
      .filter((l) => /^\d+$/.test(l.trim()))
      .pop() ?? ""
  );
}

function inserirEvolucao(autor: string, extra: Partial<Record<string, string>> = {}): string {
  const campos = {
    organization_id: `'${GOV_ORG}'`,
    contact_id: `'${GOV_CONTACT_1}'`,
    modalidade: `'fisioterapia'`,
    tipo: `'evolucao'`,
    texto: `'Dor 4/10 no ombro direito; ganho de 15 graus de flexão.'`,
    autor_user_id: `'${autor}'`,
    autor_nome: `'Nome forjado'`,
    autor_registro: `'CRM-XX 0'`,
    assinado_em: `'2001-01-01'`,
    ...extra,
  };
  return `insert into public.prontuario_registros (${Object.keys(campos).join(", ")})
          values (${Object.values(campos).join(", ")})`;
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_clinica_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'clinica-regras-b', 'Clinica Regras B', 'Clin B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;

    insert into public.clinica_profissionais
      (organization_id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo)
    values
      ('${GOV_ORG}', '${GOV_AGENT_A}', 'Dra. Fisio Invariante', 'CREFITO', '12345-F', 'SP', array['fisioterapia','pilates'], true),
      ('${GOV_ORG}', '${GOV_AGENT_B}', 'Ex-profissional', 'CREFITO', '99999-F', 'SP', array['fisioterapia'], false)
    on conflict (organization_id, user_id) do nothing;

    -- Registros semeados pelo dono (sem auth.uid(): a assinatura vem do próprio insert).
    insert into public.prontuario_registros
      (id, organization_id, contact_id, modalidade, tipo, texto, autor_user_id, autor_nome, autor_registro)
    values
      ('${REG_A}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'fisioterapia', 'avaliacao', 'Avaliação inicial', '${GOV_AGENT_A}', 'Dra. Fisio Invariante', 'CREFITO-SP 12345-F'),
      ('${REG_B}', '${ORG_B}', '${CONTATO_B}', 'medicina', 'anamnese', 'Anamnese B', null, 'Médico B', 'CRM-RJ 1')
    on conflict (id) do nothing;

    insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, contact_id)
    values ('${COMPROMISSO_OUTRO}', '${GOV_ORG}', 'Sessão de outro paciente', now(), now() + interval '50 minutes', '${GOV_CONTACT_2}')
    on conflict (id) do nothing;
  `);
});

describe("quem lê o prontuário", () => {
  it("profissional ativo lê o registro do paciente da própria clínica (controle positivo)", () => {
    expect(
      countAs(
        GOV_AGENT_A,
        `select count(*) from public.prontuario_registros where id = '${REG_A}';`,
      ),
    ).toBe(1);
  });

  it("papel alto sem cadastro de profissional não lê: manager e admin", () => {
    expect(countAs(GOV_MANAGER, `select count(*) from public.prontuario_registros;`)).toBe(0);
    expect(countAs(GOV_ADMIN, `select count(*) from public.prontuario_registros;`)).toBe(0);
  });

  it("profissional desativado não lê mais", () => {
    expect(countAs(GOV_AGENT_B, `select count(*) from public.prontuario_registros;`)).toBe(0);
  });

  it("profissional não lê prontuário de outra organização", () => {
    expect(
      countAs(
        GOV_AGENT_A,
        `select count(*) from public.prontuario_registros where id = '${REG_B}';`,
      ),
    ).toBe(0);
  });

  it("membro que perdeu o acesso à organização não lê, mesmo com o cadastro ativo", () => {
    const fora = "cccccccc-9001-4000-8000-0000000000e1";
    sql(`
      insert into auth.users (id, email) values ('${fora}', 'clinica-revogado@invariant.test') on conflict do nothing;
      insert into public.user_organizations (user_id, organization_id, role, accepted_at, revoked_at)
        values ('${fora}', '${GOV_ORG}', 'agent', now(), now()) on conflict do nothing;
      insert into public.clinica_profissionais
        (organization_id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades)
        values ('${GOV_ORG}', '${fora}', 'Revogado', 'CREFITO', '1', 'SP', array['fisioterapia'])
        on conflict (organization_id, user_id) do nothing;
    `);
    expect(countAs(fora, `select count(*) from public.prontuario_registros;`)).toBe(0);
  });
});

describe("sessão de suporte da plataforma não lê prontuário", () => {
  it("o mesmo usuário lê sem suporte e deixa de ler com o suporte ativo", () => {
    const leitura = (comSuporte: boolean) =>
      ultimoNumero(
        sql(`
          begin;
          insert into auth.users (id, email) values ('${ATOR_SUPORTE}', 'clinica-suporte@invariant.test') on conflict do nothing;
          insert into auth.sessions (id, user_id, aal) values ('${SESSAO_SUPORTE}', '${ATOR_SUPORTE}', 'aal1') on conflict do nothing;
          insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason)
            values ('${ATOR_SUPORTE}', '${ATOR_SUPORTE}', 'full', false, 'Invariante clinica') on conflict do nothing;
          insert into public.user_organizations (user_id, organization_id, role, accepted_at)
            values ('${ATOR_SUPORTE}', '${GOV_ORG}', 'admin', now()) on conflict do nothing;
          insert into public.clinica_profissionais
            (organization_id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades)
            values ('${GOV_ORG}', '${ATOR_SUPORTE}', 'Operador', 'CRM', '2', 'SP', array['medicina'])
            on conflict (organization_id, user_id) do nothing;
          ${comSuporte ? `select public.fn_start_support('${ATOR_SUPORTE}', '${SESSAO_SUPORTE}', '${GOV_ORG}', null, 'full', 600);` : ""}
          select set_config('request.jwt.claims', '{"sub":"${ATOR_SUPORTE}","session_id":"${SESSAO_SUPORTE}","aal":"aal1"}', true);
          set local role authenticated;
          select count(*) from public.prontuario_registros where id = '${REG_A}';
          rollback;
        `),
      );
    expect(leitura(false)).toBe("1");
    expect(leitura(true)).toBe("0");
  });
});

describe("quem escreve, e a assinatura", () => {
  it("profissional registra evolução; nome, conselho e hora vêm do cadastro e do relógio do banco", () => {
    expect(erroComo(GOV_AGENT_A, inserirEvolucao(GOV_AGENT_A))).toBe("");
    const linha = lastLine(
      sql(`select autor_nome || '|' || autor_registro || '|' || (assinado_em > now() - interval '1 minute')::text
             from public.prontuario_registros
            where autor_user_id = '${GOV_AGENT_A}' and tipo = 'evolucao'
            order by created_at desc limit 1;`),
    );
    expect(linha).toBe("Dra. Fisio Invariante|CREFITO-SP 12345-F|true");
  });

  // O gatilho BEFORE INSERT roda antes do WITH CHECK da RLS, então a recusa chega com o
  // nome da regra do gatilho — mais claro para quem lê o erro do que "row-level security".
  it("ninguém assina como outra pessoa", () => {
    expect(erroComo(GOV_AGENT_A, inserirEvolucao(GOV_ADMIN))).toContain(
      "prontuario_autor_nao_e_quem_assina",
    );
  });

  it("papel alto sem cadastro não escreve, nem profissional desativado", () => {
    for (const quem of [GOV_MANAGER, GOV_ADMIN, GOV_AGENT_B]) {
      expect(erroComo(quem, inserirEvolucao(quem))).toContain(
        "prontuario_sem_cadastro_de_profissional",
      );
    }
  });

  it("modalidade fora do cadastro é recusada", () => {
    expect(
      erroComo(GOV_AGENT_A, inserirEvolucao(GOV_AGENT_A, { modalidade: `'medicina'` })),
    ).toContain("prontuario_modalidade_fora_do_cadastro");
  });

  it("contato de outra organização é recusado", () => {
    expect(
      erroComo(GOV_AGENT_A, inserirEvolucao(GOV_AGENT_A, { contact_id: `'${CONTATO_B}'` })),
    ).toContain("prontuario_contato_de_outra_organizacao");
  });

  it("evolução não se pendura em sessão da agenda de outro paciente", () => {
    expect(
      erroComo(
        GOV_AGENT_A,
        inserirEvolucao(GOV_AGENT_A, { appointment_id: `'${COMPROMISSO_OUTRO}'` }),
      ),
    ).toContain("prontuario_compromisso_nao_e_do_paciente");
  });

  it("registro vazio é recusado", () => {
    expect(erroComo(GOV_AGENT_A, inserirEvolucao(GOV_AGENT_A, { texto: `'   '` }))).toContain(
      "prontuario_registros_tem_conteudo",
    );
  });
});

describe("assinado não muda: correção é adendo", () => {
  it("pela sessão, nem o próprio autor edita ou apaga", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.prontuario_registros set texto = 'reescrito' where id = '${REG_A}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(GOV_AGENT_A, `delete from public.prontuario_registros where id = '${REG_A}'`),
    ).toBe(0);
    expect(
      countAs(
        GOV_AGENT_A,
        `select count(*) from public.prontuario_registros where id = '${REG_A}' and texto = 'Avaliação inicial';`,
      ),
    ).toBe(1);
  });

  it("nem por fora da RLS (service_role, dono): o gatilho recusa editar e apagar", () => {
    expect(
      erroComoDono(
        `update public.prontuario_registros set texto = 'reescrito' where id = '${REG_A}'`,
      ),
    ).toContain("prontuario_registro_imutavel");
    expect(erroComoDono(`delete from public.prontuario_registros where id = '${REG_A}'`)).toContain(
      "prontuario_registro_imutavel",
    );
  });

  it("adendo aponta o original do mesmo paciente", () => {
    expect(
      erroComo(
        GOV_AGENT_A,
        inserirEvolucao(GOV_AGENT_A, { tipo: `'adendo'`, adendo_de: `'${REG_A}'` }),
      ),
    ).toBe("");
    expect(erroComo(GOV_AGENT_A, inserirEvolucao(GOV_AGENT_A, { tipo: `'adendo'` }))).toContain(
      "prontuario_registros_adendo_aponta_o_original",
    );
    expect(
      erroComo(
        GOV_AGENT_A,
        inserirEvolucao(GOV_AGENT_A, { tipo: `'adendo'`, adendo_de: `'${REG_B}'` }),
      ),
    ).toContain("prontuario_adendo_de_outro_paciente");
  });

  it("a cascata da organização excluída é a única remoção aceita", () => {
    const org = "cccccccc-9001-4000-8000-0000000000d0";
    const contato = "cccccccc-9001-4000-8000-0000000000d1";
    const saida = sql(`
      begin;
      insert into public.organizations (id, slug, legal_name, display_name) values ('${org}', 'clinica-descarte', 'Descarte', 'Descarte');
      insert into public.contacts (id, organization_id, display_name) values ('${contato}', '${org}', 'Paciente descarte');
      insert into public.prontuario_registros (organization_id, contact_id, modalidade, tipo, texto, autor_nome, autor_registro)
        values ('${org}', '${contato}', 'pilates', 'evolucao', 'Aula 1', 'X', 'CREF-SP 1');
      delete from public.organizations where id = '${org}';
      select count(*) from public.prontuario_registros where organization_id = '${org}';
      rollback;
    `);
    expect(ultimoNumero(saida)).toBe("0");
  });
});

describe("trilha de acessos", () => {
  it("profissional registra a abertura como si mesmo; só o admin lê a trilha", () => {
    expect(
      erroComo(
        GOV_AGENT_A,
        `insert into public.prontuario_acessos (organization_id, contact_id, user_id) values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${GOV_AGENT_A}')`,
      ),
    ).toBe("");
    expect(
      countAs(
        GOV_ADMIN,
        `select count(*) from public.prontuario_acessos where user_id = '${GOV_AGENT_A}';`,
      ),
    ).toBeGreaterThan(0);
    expect(countAs(GOV_MANAGER, `select count(*) from public.prontuario_acessos;`)).toBe(0);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.prontuario_acessos;`)).toBe(0);
  });

  it("ninguém apaga nem reescreve a trilha pela sessão", () => {
    expect(writeCountAs(GOV_ADMIN, `delete from public.prontuario_acessos`)).toBe(0);
    expect(writeCountAs(GOV_ADMIN, `update public.prontuario_acessos set user_id = null`)).toBe(0);
  });
});

describe("cadastro de profissionais", () => {
  it("só o admin cadastra; a recepção não se promove a profissional", () => {
    const cadastro = (quem: string) =>
      `insert into public.clinica_profissionais (organization_id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades)
       values ('${GOV_ORG}', '${quem}', 'Recepção', 'outro', '0', 'SP', array['pilates'])`;
    expect(writeCountAs(GOV_MANAGER, cadastro(GOV_MANAGER))).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `update public.clinica_profissionais set ativo = true where user_id = '${GOV_AGENT_B}' and organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(1);
    sql(`update public.clinica_profissionais set ativo = false where user_id = '${GOV_AGENT_B}';`);
  });
});
