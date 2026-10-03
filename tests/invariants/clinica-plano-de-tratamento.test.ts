import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_CONTACT_1,
  GOV_CONTACT_2,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * O PLANO DE TRATAMENTO NASCE DA AVALIAÇÃO ASSINADA (migration 9006, fork TOQ).
 *
 * Quem escreve o plano é o gatilho do prontuário, não a sessão: a recepção lê o plano (sessões,
 * frequência, data da reavaliação) sem ler o prontuário, e ninguém fabrica um plano sem
 * avaliação assinada por trás. A alta fecha o plano da modalidade.
 *
 * Elenco: GOV_AGENT_A é fisioterapeuta ativo; GOV_MANAGER é a recepção (sem conselho).
 */
const ORG_B = "cccccccc-9006-4000-8000-0000000000b0";
const CONTATO_B = "cccccccc-9006-4000-8000-0000000000b1";

/** Assina um registro como o profissional logado, pela sessão (RLS e gatilhos valendo). */
function assinar(contato: string, tipo: string, conteudo: Record<string, unknown>): void {
  sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${GOV_AGENT_A}"}', false);
    insert into public.prontuario_registros
      (organization_id, contact_id, modalidade, tipo, conteudo, autor_user_id, autor_nome, autor_registro)
    values
      ('${GOV_ORG}', '${contato}', 'fisioterapia', '${tipo}', '${JSON.stringify(conteudo)}'::jsonb,
       '${GOV_AGENT_A}', '', '');
  `);
}

/** Uma linha do plano do contato, como o dono a vê (por fora da RLS). */
function planos(contato: string): string[] {
  const saida = sql(`
    select situacao || '|' || coalesce(sessoes_previstas::text, '-') || '|' ||
           coalesce(frequencia_semanal::text, '-') || '|' || coalesce(reavaliacao_em::text, '-') || '|' ||
           retorno_situacao || '|' || coalesce(alta_motivo, '-') || '|' || avaliador_nome
      from public.clinica_planos_tratamento
     where contact_id = '${contato}'
     order by created_at, id;
  `);
  return saida ? saida.split("\n") : [];
}

beforeAll(() => {
  seedGov();
  sql(`select public.fn_clinica_provisionar();`);
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'clinica-plano-b', 'Clinica Plano B', 'Plano B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;
    insert into public.clinica_profissionais
      (organization_id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo)
    values
      ('${GOV_ORG}', '${GOV_AGENT_A}', 'Dra. Fisio Plano', 'CREFITO', '12345-F', 'SP', array['fisioterapia'], true)
    on conflict (organization_id, user_id) do nothing;
  `);
});

describe("o plano nasce da avaliação assinada", () => {
  it("avaliação com sessões, frequência e data cria o plano e pede o retorno", () => {
    assinar(GOV_CONTACT_1, "avaliacao", {
      diagnostico_fisioterapeutico: "Tendinopatia do supraespinhal",
      prognostico: "Bom",
      objetivos: "Sem dor em 6 semanas",
      numero_de_sessoes: 10,
      frequencia_semanal: 2,
      data_reavaliacao: "2026-11-20",
    });
    expect(planos(GOV_CONTACT_1)).toEqual(["ativo|10|2|2026-11-20|a_marcar|-|Dra. Fisio Plano"]);
  });

  it("o plano não copia conteúdo clínico", () => {
    const colunas = sql(`
      select string_agg(column_name, ',' order by column_name) from information_schema.columns
       where table_schema = 'public' and table_name = 'clinica_planos_tratamento';
    `);
    for (const clinico of [
      "diagnostico",
      "objetivos",
      "prognostico",
      "conduta",
      "conteudo",
      "texto",
    ]) {
      expect(colunas).not.toContain(clinico);
    }
  });

  it("avaliação nova da mesma modalidade substitui o plano anterior", () => {
    assinar(GOV_CONTACT_1, "avaliacao", {
      diagnostico_fisioterapeutico: "Reavaliado",
      prognostico: "Bom",
      objetivos: "Manter",
      numero_de_sessoes: "8",
    });
    expect(planos(GOV_CONTACT_1)).toEqual([
      "substituido|10|2|2026-11-20|a_marcar|-|Dra. Fisio Plano",
      "ativo|8|-|-|nao_pedido|-|Dra. Fisio Plano",
    ]);
  });

  it("a alta fecha o plano ativo da modalidade com o motivo", () => {
    assinar(GOV_CONTACT_1, "alta", { motivo: "objetivo_atingido", resumo: "Sem dor." });
    expect(planos(GOV_CONTACT_1)[1]).toBe(
      "alta|8|-|-|nao_pedido|objetivo_atingido|Dra. Fisio Plano",
    );
  });

  it("avaliação sem plano e valores fora do formato não criam plano nem derrubam a assinatura", () => {
    assinar(GOV_CONTACT_2, "avaliacao", {
      diagnostico_fisioterapeutico: "Lombalgia",
      prognostico: "Reservado",
      objetivos: "Voltar a correr",
      numero_de_sessoes: "dez",
      data_reavaliacao: "2026-13-45",
    });
    expect(planos(GOV_CONTACT_2)).toEqual([]);
    expect(
      sql(
        `select count(*) from public.prontuario_registros where contact_id = '${GOV_CONTACT_2}';`,
      ),
    ).toBe("1");
  });
});

describe("quem lê e quem escreve o plano", () => {
  it("a recepção e o somente leitura leem o plano sem ser profissional", () => {
    expect(
      countAs(
        GOV_MANAGER,
        `select count(*) from public.clinica_planos_tratamento where contact_id = '${GOV_CONTACT_1}';`,
      ),
    ).toBe(2);
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.clinica_planos_tratamento where contact_id = '${GOV_CONTACT_1}';`,
      ),
    ).toBe(2);
  });

  it("outra organização não enxerga o plano", () => {
    sql(`
      insert into public.prontuario_registros
        (organization_id, contact_id, modalidade, tipo, conteudo, autor_nome, autor_registro)
      values ('${ORG_B}', '${CONTATO_B}', 'fisioterapia', 'avaliacao', '{"numero_de_sessoes": 5}', 'Fisio B', 'CREFITO-RJ 1');
    `);
    expect(
      countAs(
        GOV_ADMIN,
        `select count(*) from public.clinica_planos_tratamento where contact_id = '${CONTATO_B}';`,
      ),
    ).toBe(0);
    expect(
      sql(
        `select count(*) from public.clinica_planos_tratamento where contact_id = '${CONTATO_B}';`,
      ),
    ).toBe("1");
  });

  it("ninguém escreve o plano pela sessão: nem o admin, nem o profissional", () => {
    for (const quem of [GOV_ADMIN, GOV_AGENT_A]) {
      expect(
        writeCountAs(
          quem,
          `update public.clinica_planos_tratamento set sessoes_previstas = 50 where organization_id = '${GOV_ORG}'`,
        ),
      ).toBe(0);
      expect(
        writeCountAs(
          quem,
          `delete from public.clinica_planos_tratamento where organization_id = '${GOV_ORG}'`,
        ),
      ).toBe(0);
    }
  });
});
