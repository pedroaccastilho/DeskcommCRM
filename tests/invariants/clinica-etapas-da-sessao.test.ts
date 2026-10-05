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
  tableExists,
  writeCountAs,
} from "./gov-helpers";

/**
 * AS ETAPAS DO DIA DA SESSÃO NO BANCO: "chegou" e "em atendimento" (migration 9007, fork TOQ).
 *
 * O que só o banco garante: a tabela nasce só quando a clínica é instalada (não está no
 * baseline), a provisionadora pode rodar de novo sem mudar nada, uma clínica não vê a etapa da
 * outra, ninguém grava etapa pela API do Supabase (só o servidor, pela rota, que confere papel e
 * sessão), não há atendimento sem chegada e há uma linha só por sessão. As regras da rota (só
 * sessão da clínica e em aberto, idempotência do botão) têm teste unitário em
 * `tests/unit/clinica-etapa-da-sessao-route.test.ts`.
 */
const ORG_B = "cccccccc-9007-4000-8000-0000000000b0";
const MEMBRO_B = "cccccccc-9007-4000-8000-0000000000b9";
const CONTATO_B = "cccccccc-9007-4000-8000-0000000000b1";
const SESSAO_A = "cccccccc-9007-4000-8000-0000000000a1";
const SESSAO_A2 = "cccccccc-9007-4000-8000-0000000000a2";
const SESSAO_B = "cccccccc-9007-4000-8000-0000000000b3";

function erroComoDono(comando: string): string {
  try {
    sql(`${comando};`);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

let existiaAntesDeInstalar = true;

beforeAll(() => {
  seedGov();
  existiaAntesDeInstalar = tableExists("clinica_sessao_etapas");
  sql(`
    select public.fn_clinica_provisionar();

    insert into auth.users (id, email) values ('${MEMBRO_B}', 'etapas-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'clinica-etapas-b', 'Clinica Etapas B', 'Clin Etapas B')
      on conflict (id) do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at)
      values ('${MEMBRO_B}', '${ORG_B}', 'admin', now()) on conflict do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;

    insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, contact_id)
    values
      ('${SESSAO_A}', '${GOV_ORG}', 'Sessão A', now(), now() + interval '50 minutes', '${GOV_CONTACT_1}'),
      ('${SESSAO_A2}', '${GOV_ORG}', 'Sessão A2', now() + interval '1 hour', now() + interval '110 minutes', '${GOV_CONTACT_1}'),
      ('${SESSAO_B}', '${ORG_B}', 'Sessão B', now(), now() + interval '50 minutes', '${CONTATO_B}')
    on conflict (id) do nothing;

    -- Etapas semeadas pelo dono (como o servidor faria).
    insert into public.clinica_sessao_etapas (organization_id, appointment_id, chegou_em, chegou_por_user_id)
    values
      ('${GOV_ORG}', '${SESSAO_A}', now(), '${GOV_AGENT_A}'),
      ('${ORG_B}', '${SESSAO_B}', now(), '${MEMBRO_B}')
    on conflict (organization_id, appointment_id) do nothing;
  `);
});

describe("etapas da sessão: a provisionadora", () => {
  it("a tabela não está no baseline: nasce quando a clínica é instalada", () => {
    expect(
      existiaAntesDeInstalar,
      "clinica_sessao_etapas existia antes de provisionar — ela foi parar no baseline (ADR-0002 D2)",
    ).toBe(false);
    expect(tableExists("clinica_sessao_etapas")).toBe(true);
  });

  it("a provisionadora dos pacotes chama a das etapas (a cadeia do módulo chega até ela)", () => {
    expect(
      sql(
        `select position('fn_clinica_provisionar_etapas' in p.prosrc) > 0
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'fn_clinica_provisionar_pacotes';`,
      ).trim(),
    ).toBe("t");
  });

  it("provisionar de novo não falha nem perde o que já foi marcado", () => {
    expect(erroComoDono("select public.fn_clinica_provisionar_etapas()")).toBe("");
    expect(erroComoDono("select public.fn_clinica_provisionar()")).toBe("");
    expect(
      sql(`select count(*) from public.clinica_sessao_etapas;`).trim(),
    ).toBe("2");
  });

  it("a provisionadora não é alcançável pela sessão nem pela anon key", () => {
    const fn = "public.fn_clinica_provisionar_etapas()";
    expect(
      sql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
      ).trim(),
    ).toBe("false/false/true");
  });
});

describe("etapas da sessão: quem vê e quem escreve", () => {
  it("todo membro vê a etapa da própria clínica, inclusive Somente leitura (a grade é dele)", () => {
    for (const quem of [GOV_VIEWER, GOV_AGENT_A, GOV_ADMIN]) {
      expect(countAs(quem, `select count(*) from public.clinica_sessao_etapas;`)).toBe(1);
    }
  });

  it("uma clínica não vê a etapa da outra, nos dois sentidos", () => {
    expect(
      countAs(
        GOV_ADMIN,
        `select count(*) from public.clinica_sessao_etapas where appointment_id = '${SESSAO_B}';`,
      ),
    ).toBe(0);
    expect(countAs(MEMBRO_B, `select count(*) from public.clinica_sessao_etapas;`)).toBe(1);
    expect(
      countAs(
        MEMBRO_B,
        `select count(*) from public.clinica_sessao_etapas where appointment_id = '${SESSAO_A}';`,
      ),
    ).toBe(0);
  });

  it("ninguém grava, altera ou apaga etapa pela sessão, nem o administrador", () => {
    for (const quem of [GOV_VIEWER, GOV_AGENT_A, GOV_MANAGER, GOV_ADMIN]) {
      expect(
        writeCountAs(
          quem,
          `insert into public.clinica_sessao_etapas (organization_id, appointment_id, chegou_em) values ('${GOV_ORG}', '${SESSAO_A2}', now())`,
        ),
      ).toBe(0);
      expect(
        writeCountAs(
          quem,
          `update public.clinica_sessao_etapas set chegou_em = null where appointment_id = '${SESSAO_A}'`,
        ),
      ).toBe(0);
      expect(writeCountAs(quem, `delete from public.clinica_sessao_etapas`)).toBe(0);
    }
  });

  it("a anon key não lê nada", () => {
    expect(
      sql(
        `select has_table_privilege('anon', 'public.clinica_sessao_etapas', 'select');`,
      ).trim(),
    ).toBe("f");
  });
});

describe("etapas da sessão: a forma da linha", () => {
  it("não existe atendimento sem chegada", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_sessao_etapas (organization_id, appointment_id, atendimento_iniciado_em) values ('${GOV_ORG}', '${SESSAO_A2}', now())`,
      ),
    ).toContain("clinica_sessao_etapas_atendimento_depois_da_chegada");
  });

  it("uma linha só por sessão", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_sessao_etapas (organization_id, appointment_id, chegou_em) values ('${GOV_ORG}', '${SESSAO_A}', now())`,
      ),
    ).toContain("clinica_sessao_etapas_uma_por_sessao");
  });

  it("apagar a sessão no núcleo leva a etapa junto", () => {
    sql(`
      insert into public.clinica_sessao_etapas (organization_id, appointment_id, chegou_em)
        values ('${GOV_ORG}', '${SESSAO_A2}', now())
        on conflict (organization_id, appointment_id) do nothing;
      delete from public.calendar_appointments where id = '${SESSAO_A2}';
    `);
    expect(
      sql(
        `select count(*) from public.clinica_sessao_etapas where appointment_id = '${SESSAO_A2}';`,
      ).trim(),
    ).toBe("0");
  });
});
