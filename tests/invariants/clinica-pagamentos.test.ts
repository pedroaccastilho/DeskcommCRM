import { beforeAll, describe, expect, it } from "vitest";

import {
  columnExists,
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_CONTACT_1,
  GOV_ORG,
  GOV_VIEWER,
  seedGov,
  sql,
  tableExists,
  writeCountAs,
} from "./gov-helpers";

/**
 * O PAGAMENTO REGISTRADO E A MULTA POR FALTA NO BANCO (migration 9011, fork TOQ).
 *
 * O que só o banco garante: a tabela e a coluna nascem quando a clínica é instalada (não no
 * baseline); um pagamento paga exatamente UMA coisa, e uma coisa tem no máximo um pagamento;
 * ninguém fabrica nem apaga pagamento pela API do Supabase (só o servidor escreve); "Somente
 * leitura" não vê; e outra clínica não vê. Quem pode registrar (por perfil) é do servidor, com
 * teste em `lib/clinica/pagamentos.test.ts`.
 */
const ORG_B = "cccccccc-9011-4000-8000-0000000000b0";
const CONTATO_B = "cccccccc-9011-4000-8000-0000000000b1";
const SESSAO = "cccccccc-9011-4000-8000-0000000000a1";
const SESSAO_FALTA = "cccccccc-9011-4000-8000-0000000000a2";
const PACOTE = "cccccccc-9011-4000-8000-0000000000a3";
const MULTA = "cccccccc-9011-4000-8000-0000000000a4";
const PAGAMENTO_B = "cccccccc-9011-4000-8000-0000000000b2";
const PACOTE_B = "cccccccc-9011-4000-8000-0000000000b3";

let tabelaAntes = true;
let colunaAntes = true;

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
  tabelaAntes = tableExists("clinica_pagamentos");
  colunaAntes = tableExists("clinica_multas") && columnExists("clinica_multas", "origem");
  sql(`
    select public.fn_clinica_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'clinica-pagamentos-b', 'Clinica Pagamentos B', 'Clin Pagamentos B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;

    insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, contact_id, status)
    values
      ('${SESSAO}', '${GOV_ORG}', 'Sessão avulsa', now() - interval '2 days', now() - interval '2 days' + interval '1 hour', '${GOV_CONTACT_1}', 'completed'),
      ('${SESSAO_FALTA}', '${GOV_ORG}', 'Sessão faltou', now() - interval '1 day', now() - interval '1 day' + interval '1 hour', '${GOV_CONTACT_1}', 'no_show')
    on conflict (id) do nothing;

    insert into public.clinica_pacotes
      (id, organization_id, contact_id, nome, modalidade, sessoes_total, valor_cents, comprado_em, valido_ate,
       aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas)
    values
      ('${PACOTE}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'Pacote pago', 'fisioterapia', 10, 150000,
       now() - interval '1 day', now() + interval '59 days', now() - interval '1 day', 30, 24),
      ('${PACOTE_B}', '${ORG_B}', '${CONTATO_B}', 'Pacote B', 'fisioterapia', 10, 99000,
       now() - interval '1 day', now() + interval '59 days', now() - interval '1 day', 30, 24)
    on conflict (id) do nothing;

    -- A multa da falta, semeada pelo dono (como o servidor faria).
    insert into public.clinica_multas
      (id, organization_id, appointment_id, contact_id, percentual, antecedencia_horas, valor_cents, origem)
    values ('${MULTA}', '${GOV_ORG}', '${SESSAO_FALTA}', '${GOV_CONTACT_1}', 30, -0.5, 4500, 'falta')
    on conflict (id) do nothing;

    insert into public.clinica_pagamentos (organization_id, contact_id, pacote_id, forma, valor_cents)
    values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${PACOTE}', 'pix', 150000)
    on conflict do nothing;
    insert into public.clinica_pagamentos (id, organization_id, contact_id, pacote_id, forma, valor_cents)
    values ('${PAGAMENTO_B}', '${ORG_B}', '${CONTATO_B}', '${PACOTE_B}', 'dinheiro', 99000)
    on conflict do nothing;
  `);
});

describe("pagamentos: a provisionadora", () => {
  it("tabela e coluna não estão no baseline: nascem quando a clínica é instalada", () => {
    expect(tabelaAntes, "clinica_pagamentos existia antes de provisionar (ADR-0002 D2)").toBe(
      false,
    );
    expect(colunaAntes, "clinica_multas.origem existia antes de provisionar").toBe(false);
    expect(tableExists("clinica_pagamentos")).toBe(true);
    expect(columnExists("clinica_multas", "origem")).toBe(true);
  });

  it("a multa que já existia continua de cancelamento", () => {
    expect(
      sql(`select column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'clinica_multas' and column_name = 'origem';`),
    ).toContain("cancelamento");
    expect(
      erroComoDono(`update public.clinica_multas set origem = 'outra' where id = '${MULTA}'`),
    ).toMatch(/clinica_multas_origem_valida/);
  });

  it("a provisionadora da interface chama a dos pagamentos, e provisionar de novo não apaga nada", () => {
    expect(
      sql(
        `select position('fn_clinica_provisionar_pagamentos' in p.prosrc) > 0
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'fn_clinica_provisionar_interface';`,
      ),
    ).toBe("t");
    sql(`select public.fn_clinica_provisionar();`);
    expect(
      sql(`select count(*) from public.clinica_pagamentos where pacote_id = '${PACOTE}';`),
    ).toBe("1");
  });

  it("a provisionadora não é alcançável pela sessão nem pela anon key", () => {
    const fn = "public.fn_clinica_provisionar_pagamentos()";
    expect(
      sql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
      ),
    ).toBe("false/false/true");
  });
});

describe("pagamentos: o que o banco recusa", () => {
  it("um pagamento paga exatamente uma coisa", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_pagamentos (organization_id, contact_id, forma) values ('${GOV_ORG}', '${GOV_CONTACT_1}', 'pix')`,
      ),
    ).toMatch(/clinica_pagamentos_paga_uma_coisa/);
    expect(
      erroComoDono(
        `insert into public.clinica_pagamentos (organization_id, contact_id, appointment_id, multa_id, forma)
         values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${SESSAO}', '${MULTA}', 'pix')`,
      ),
    ).toMatch(/clinica_pagamentos_paga_uma_coisa/);
  });

  it("a mesma coisa não é paga duas vezes (23505)", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_pagamentos (organization_id, contact_id, pacote_id, forma) values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${PACOTE}', 'dinheiro')`,
      ),
    ).toMatch(/clinica_pagamentos_um_por_pacote/);
  });

  it("só as quatro formas", () => {
    expect(
      erroComoDono(
        `insert into public.clinica_pagamentos (organization_id, contact_id, appointment_id, forma) values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${SESSAO}', 'boleto')`,
      ),
    ).toMatch(/check/i);
  });
});

describe("pagamentos: quem lê e quem escreve", () => {
  it("a recepção lê os da clínica; Somente leitura não vê; outra clínica não aparece", () => {
    expect(countAs(GOV_AGENT_A, `select count(*) from public.clinica_pagamentos;`)).toBe(1);
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_pagamentos;`)).toBe(0);
    expect(
      countAs(
        GOV_ADMIN,
        `select count(*) from public.clinica_pagamentos where id = '${PAGAMENTO_B}';`,
      ),
    ).toBe(0);
  });

  it("ninguém registra, muda ou apaga pagamento pela API do Supabase: só o servidor", () => {
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.clinica_pagamentos (organization_id, contact_id, appointment_id, forma) values ('${GOV_ORG}', '${GOV_CONTACT_1}', '${SESSAO}', 'pix')`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `update public.clinica_pagamentos set valor_cents = 1 where pacote_id = '${PACOTE}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `delete from public.clinica_pagamentos where pacote_id = '${PACOTE}'`,
      ),
    ).toBe(0);
  });
});
