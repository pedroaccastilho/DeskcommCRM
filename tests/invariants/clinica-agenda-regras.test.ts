import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_CONTACT_1,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * AS REGRAS DA AGENDA DA CLÍNICA QUE MORAM NO BANCO (migrations 9002 e 9003, fork TOQ).
 *
 * O PostgREST fala com o JWT da sessão sem passar por rota nenhuma. Então "a recepção não muda a
 * política de faltas", "ninguém fabrica uma multa" e "ninguém apaga o histórico da sessão" só
 * valem se a RLS disser. O que a regra de negócio decide (multa sim ou não, falta antes da
 * tolerância) é do servidor e tem teste unitário em `lib/clinica/agenda.test.ts`.
 *
 * Elenco (seedGov): GOV_AGENT_A é recepção (`agent`), GOV_MANAGER gestão, GOV_ADMIN admin,
 * GOV_VIEWER "Somente leitura". Desde a 9003 só o admin altera regras e modalidade, e a multa
 * (com valor) é de `agent`+. O preço da sessão é o do núcleo (`default_price_cents`).
 */
const ORG_B = "cccccccc-9002-4000-8000-0000000000b0";
const CONTATO_B = "cccccccc-9002-4000-8000-0000000000b1";
const TIPO_A = "cccccccc-9002-4000-8000-0000000000a2";
const TIPO_B = "cccccccc-9002-4000-8000-0000000000b2";
const SESSAO_A = "cccccccc-9002-4000-8000-0000000000a3";
const SESSAO_B = "cccccccc-9002-4000-8000-0000000000b3";

function erroComoDono(comando: string): string {
  try {
    sql(`${comando};`);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_clinica_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'clinica-agenda-b', 'Clinica Agenda B', 'Clin Agenda B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;

    insert into public.calendar_event_types (id, organization_id, name, slug) values
      ('${TIPO_A}', '${GOV_ORG}', 'Sessão de fisioterapia', 'sessao-fisio-9002'),
      ('${TIPO_B}', '${ORG_B}', 'Pilates B', 'pilates-b-9002')
      on conflict (id) do nothing;

    insert into public.calendar_appointments (id, organization_id, event_type_id, title, starts_at, ends_at, contact_id)
    values
      ('${SESSAO_A}', '${GOV_ORG}', '${TIPO_A}', 'Sessão A', now() + interval '2 hours', now() + interval '3 hours', '${GOV_CONTACT_1}'),
      ('${SESSAO_B}', '${ORG_B}', '${TIPO_B}', 'Sessão B', now() + interval '2 hours', now() + interval '3 hours', '${CONTATO_B}')
      on conflict (id) do nothing;

    insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade)
    values ('${ORG_B}', '${TIPO_B}', 'pilates')
      on conflict (organization_id, event_type_id) do nothing;

    -- Linhas que só o servidor escreve, semeadas pelo dono (como o service_role faria).
    insert into public.clinica_multas
      (organization_id, appointment_id, contact_id, percentual, antecedencia_horas, valor_cents)
    values ('${ORG_B}', '${SESSAO_B}', '${CONTATO_B}', 30, 3.5, 2700),
           ('${GOV_ORG}', '${SESSAO_A}', '${GOV_CONTACT_1}', 30, 2, 4500)
      on conflict (appointment_id) do nothing;
    insert into public.clinica_agenda_historico
      (organization_id, appointment_id, acao, de_inicio, para_inicio, por_tipo)
    values ('${ORG_B}', '${SESSAO_B}', 'remarcado', now(), now() + interval '1 day', 'ai');
  `);
});

describe("regras da clínica", () => {
  it("só o administrador grava as regras; gerente e recepção não", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.clinica_politicas (organization_id, multa_cancelamento_pct) values ('${GOV_ORG}', 0)`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.clinica_politicas (organization_id, multa_cancelamento_pct) values ('${GOV_ORG}', 40)`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.clinica_politicas (organization_id, multa_cancelamento_pct, pacote_validade_dias) values ('${GOV_ORG}', 40, 90)`,
      ),
    ).toBe(1);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.clinica_politicas set multa_cancelamento_pct = 0 where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.clinica_politicas set multa_cancelamento_pct = 0 where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
  });

  it("todo membro lê a política da própria clínica, e só dela (a agenda calcula os prazos com ela)", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_politicas;`)).toBe(1);
  });

  it("valores fora da faixa são recusados", () => {
    expect(
      erroComoDono(
        `update public.clinica_politicas set multa_cancelamento_pct = 150 where organization_id = '${GOV_ORG}'`,
      ),
    ).toMatch(/check constraint/);
    expect(
      erroComoDono(
        `update public.clinica_politicas set pacote_validade_dias = 0 where organization_id = '${GOV_ORG}'`,
      ),
    ).toMatch(/check constraint/);
  });

  it("os parâmetros novos nascem com os padrões das regras da TOQ", () => {
    expect(
      sql(
        `select pacote_sessoes_padrao || '/' || reposicoes_por_mes || '/' || faltas_no_mes_abandono from public.clinica_politicas where organization_id = '${GOV_ORG}';`,
      ).trim(),
    ).toBe("10/2/3");
  });
});

describe("modalidade dos tipos de atendimento", () => {
  it("só o administrador etiqueta tipo da própria clínica", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade) values ('${GOV_ORG}', '${TIPO_A}', 'fisioterapia')`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade) values ('${GOV_ORG}', '${TIPO_A}', 'fisioterapia')`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade) values ('${GOV_ORG}', '${TIPO_A}', 'fisioterapia')`,
      ),
    ).toBe(1);
  });

  it("tipo de outra organização é recusado, até por fora da RLS", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade) values ('${GOV_ORG}', '${TIPO_B}', 'pilates')`,
      ),
    ).toMatch(/clinica_tipo_de_outra_organizacao/);
  });

  it("modalidade fora do vocabulário é recusada", () => {
    expect(
      erroComoDono(
        `update public.clinica_tipos_atendimento set modalidade = 'nutricao' where event_type_id = '${TIPO_A}'`,
      ),
    ).toMatch(/check constraint/);
  });

  it("uma clínica não vê a etiqueta da outra, e todo membro vê a da própria", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_tipos_atendimento;`)).toBe(1);
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_tipos_atendimento;`)).toBe(1);
  });
});

describe("preço da sessão: um só, o do núcleo (9003)", () => {
  it("a tabela de modalidade não guarda preço", () => {
    expect(
      sql(
        `select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clinica_tipos_atendimento' and column_name in ('valor_cents', 'currency');`,
      ).trim(),
    ).toBe("0");
  });

  it("o preço que a 9002 gravou vai para o preço padrão do tipo, sem sobrescrever um que exista", () => {
    // O bloco `do` da 9003 é o que roda no update de quem tinha a 9002; ele é lido do próprio
    // arquivo da migration para o teste medir o SQL que vai para o cliente.
    const migracao = readFileSync(
      join(process.cwd(), "supabase/migrations/20261002020000_9003_clinica_regras_admin.sql"),
      "utf8",
    );
    const inicio = migracao.indexOf("do $m$");
    const blocoDeCopia = migracao.slice(inicio, migracao.indexOf("$m$;", inicio) + 4);
    expect(blocoDeCopia).toContain("default_price_cents");

    sql(`
      update public.calendar_event_types set default_price_cents = null where id = '${TIPO_B}';
      update public.calendar_event_types set default_price_cents = 12000 where id = '${TIPO_A}';
      alter table public.clinica_tipos_atendimento
        add column if not exists valor_cents int,
        add column if not exists currency text not null default 'BRL';
      insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade)
      values ('${GOV_ORG}', '${TIPO_A}', 'fisioterapia')
        on conflict (organization_id, event_type_id) do nothing;
      update public.clinica_tipos_atendimento set valor_cents = 8800 where event_type_id = '${TIPO_B}';
      update public.clinica_tipos_atendimento set valor_cents = 1 where event_type_id = '${TIPO_A}';
    `);
    sql(blocoDeCopia);
    sql(`select public.fn_clinica_provisionar_agenda();`);

    expect(
      sql(`select default_price_cents from public.calendar_event_types where id = '${TIPO_B}';`).trim(),
    ).toBe("8800");
    expect(
      sql(`select default_price_cents from public.calendar_event_types where id = '${TIPO_A}';`).trim(),
    ).toBe("12000");
    expect(
      sql(
        `select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clinica_tipos_atendimento' and column_name = 'valor_cents';`,
      ).trim(),
    ).toBe("0");
    // Reaplicar de novo, com a coluna já fora, não quebra.
    expect(erroComoDono(blocoDeCopia.replace(/;$/, ""))).toBe("");
    expect(erroComoDono(`select public.fn_clinica_provisionar_agenda()`)).toBe("");
  });
});

describe("multa e histórico: só o servidor escreve", () => {
  it("nem o admin cria multa pela sessão", () => {
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.clinica_multas (organization_id, appointment_id, contact_id, percentual, antecedencia_horas) values ('${GOV_ORG}', '${SESSAO_A}', '${GOV_CONTACT_1}', 30, 2)`,
      ),
    ).toBe(0);
  });

  it("nem o admin escreve ou apaga histórico pela sessão", () => {
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.clinica_agenda_historico (organization_id, appointment_id, acao, por_tipo) values ('${GOV_ORG}', '${SESSAO_A}', 'cancelado', 'user')`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(GOV_ADMIN, `delete from public.clinica_agenda_historico`),
    ).toBe(0);
  });

  it("isolamento: a multa e o histórico da outra clínica não aparecem", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_multas;`)).toBe(1);
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_agenda_historico;`)).toBe(0);
  });

  it("a recepção vê a multa que cobra; o perfil Somente leitura não vê valor", () => {
    expect(countAs(GOV_AGENT_A, `select count(*) from public.clinica_multas;`)).toBe(1);
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_multas;`)).toBe(0);
  });

  it("uma multa por sessão", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_multas (organization_id, appointment_id, contact_id, percentual, antecedencia_horas) values ('${ORG_B}', '${SESSAO_B}', '${CONTATO_B}', 30, 1)`,
      ),
    ).toMatch(/clinica_multas_uma_por_sessao/);
  });

  it("isentar exige motivo e data", () => {
    expect(
      erroComoDono(
        `update public.clinica_multas set status = 'isenta' where appointment_id = '${SESSAO_B}'`,
      ),
    ).toMatch(/clinica_multas_isencao_justificada/);
    expect(
      erroComoDono(
        `update public.clinica_multas set status = 'isenta', isencao_motivo = 'Atestado médico', isenta_em = now() where appointment_id = '${SESSAO_B}'`,
      ),
    ).toBe("");
  });

  it("remarcação sem o de e o para é recusada", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_agenda_historico (organization_id, appointment_id, acao, por_tipo) values ('${ORG_B}', '${SESSAO_B}', 'remarcado', 'user')`,
      ),
    ).toMatch(/clinica_agenda_historico_remarcacao_tem_de_e_para/);
  });
});
