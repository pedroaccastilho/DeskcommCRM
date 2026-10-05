import { beforeAll, describe, expect, it } from "vitest";

import {
  columnExists,
  GOV_ADMIN,
  GOV_MANAGER,
  GOV_ORG,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * A INTERFACE NOVA COMO A PRINCIPAL DA EQUIPE, no banco (migration 9010, fork TOQ).
 *
 * O que só o banco garante: a coluna nasce quando a clínica é instalada (não no baseline), nasce
 * DESLIGADA (instalar ou atualizar o módulo não muda a tela de ninguém), a provisionadora pode
 * rodar de novo sem apagar a escolha, e só o Administrador a muda pela API do Supabase. Para
 * onde cada tela da interface atual leva tem teste unitário em `lib/novo/raiz.test.ts`.
 */
let existiaAntesDeInstalar = true;

beforeAll(() => {
  seedGov();
  existiaAntesDeInstalar = columnExists("clinica_politicas", "interface_nova_principal");
  sql(`
    select public.fn_clinica_provisionar();
    insert into public.clinica_politicas (organization_id) values ('${GOV_ORG}')
      on conflict (organization_id) do nothing;
  `);
});

describe("interface principal da equipe: a provisionadora", () => {
  it("a coluna não está no baseline: nasce quando a clínica é instalada, desligada", () => {
    expect(
      existiaAntesDeInstalar,
      "interface_nova_principal existia antes de provisionar — foi parar no baseline (ADR-0002 D2)",
    ).toBe(false);
    expect(columnExists("clinica_politicas", "interface_nova_principal")).toBe(true);
    expect(
      sql(
        `select interface_nova_principal from public.clinica_politicas where organization_id = '${GOV_ORG}';`,
      ).trim(),
    ).toBe("f");
  });

  it("a provisionadora das etapas chama a da interface (a cadeia do módulo chega até ela)", () => {
    expect(
      sql(
        `select position('fn_clinica_provisionar_interface' in p.prosrc) > 0
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'fn_clinica_provisionar_etapas';`,
      ).trim(),
    ).toBe("t");
  });

  it("provisionar de novo não desliga a escolha já feita", () => {
    sql(
      `update public.clinica_politicas set interface_nova_principal = true where organization_id = '${GOV_ORG}';
       select public.fn_clinica_provisionar();`,
    );
    expect(
      sql(
        `select interface_nova_principal from public.clinica_politicas where organization_id = '${GOV_ORG}';`,
      ).trim(),
    ).toBe("t");
    sql(
      `update public.clinica_politicas set interface_nova_principal = false where organization_id = '${GOV_ORG}';`,
    );
  });

  it("a provisionadora não é alcançável pela sessão nem pela anon key", () => {
    const fn = "public.fn_clinica_provisionar_interface()";
    expect(
      sql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
      ).trim(),
    ).toBe("false/false/true");
  });
});

describe("interface principal da equipe: quem decide", () => {
  it("só o Administrador muda a escolha; o Gerente não", () => {
    expect(
      writeCountAs(
        GOV_MANAGER,
        `update public.clinica_politicas set interface_nova_principal = true where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `update public.clinica_politicas set interface_nova_principal = true where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(1);
  });
});
