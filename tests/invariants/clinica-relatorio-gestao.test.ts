import { beforeAll, describe, expect, it } from "vitest";

import { seedGov, sql } from "./gov-helpers";

/**
 * O RELATÓRIO DA GESTÃO NO BANCO (migration 9009, fork TOQ).
 *
 * O que só o banco garante: as funções não são alcançáveis pela sessão nem pela anon key; o
 * relatório conta cada sessão uma vez, pela situação dela, só as da clínica (tipo com
 * modalidade) e só as do período; avulsa é a realizada que não gastou pacote; uma clínica não
 * entra no relatório nem na exportação da outra.
 *
 * Usa organizações próprias (não a GOV_ORG): os números exatos não podem depender do que outro
 * arquivo de invariante semeou no mesmo banco.
 */
const ORG_A = "cccccccc-9009-4000-8000-0000000000a0";
const ORG_B = "cccccccc-9009-4000-8000-0000000000b0";
const TIPO_A = "cccccccc-9009-4000-8000-0000000000a1";
const TIPO_SEM_MODALIDADE = "cccccccc-9009-4000-8000-0000000000a2";
const TIPO_B = "cccccccc-9009-4000-8000-0000000000b1";
const PACIENTE_1 = "cccccccc-9009-4000-8000-0000000000c1";
const PACIENTE_2 = "cccccccc-9009-4000-8000-0000000000c2";
const PACIENTE_B = "cccccccc-9009-4000-8000-0000000000cb";
const PACOTE = "cccccccc-9009-4000-8000-0000000000d1";
const s = (n: number) => `cccccccc-9009-4000-8000-0000000001${String(n).padStart(2, "0")}`;

const JANELA = "now() - interval '10 days', now() + interval '10 days'";

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_clinica_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'clinica-gestao-a', 'Clinica Gestao A', 'Gestao A'),
      ('${ORG_B}', 'clinica-gestao-b', 'Clinica Gestao B', 'Gestao B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, created_at) values
      ('${PACIENTE_1}', '${ORG_A}', 'Paciente Um', now()),
      ('${PACIENTE_2}', '${ORG_A}', 'Paciente Dois', now() - interval '400 days'),
      ('${PACIENTE_B}', '${ORG_B}', 'Paciente B', now())
      on conflict (id) do nothing;
    insert into public.calendar_event_types (id, organization_id, name, slug, default_price_cents) values
      ('${TIPO_A}', '${ORG_A}', 'Fisio', 'fisio-9009-a', 12000),
      ('${TIPO_SEM_MODALIDADE}', '${ORG_A}', 'Reunião', 'reuniao-9009-a', null),
      ('${TIPO_B}', '${ORG_B}', 'Fisio B', 'fisio-9009-b', 12000)
      on conflict (id) do nothing;
    insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade) values
      ('${ORG_A}', '${TIPO_A}', 'fisioterapia'),
      ('${ORG_B}', '${TIPO_B}', 'fisioterapia')
      on conflict (organization_id, event_type_id) do nothing;

    -- Na clínica A: duas realizadas (uma do pacote), uma falta, uma cancelada, uma em aberto,
    -- uma fora do período e uma reunião (tipo sem modalidade, não é sessão da clínica).
    insert into public.calendar_appointments
      (id, organization_id, event_type_id, title, starts_at, ends_at, contact_id, status, cancelled_at)
    values
      ('${s(1)}', '${ORG_A}', '${TIPO_A}', 'S1', now() - interval '2 days', now() - interval '47 hours', '${PACIENTE_1}', 'completed', null),
      ('${s(2)}', '${ORG_A}', '${TIPO_A}', 'S2', now() - interval '3 days', now() - interval '71 hours', '${PACIENTE_2}', 'completed', null),
      ('${s(3)}', '${ORG_A}', '${TIPO_A}', 'S3', now() - interval '4 days', now() - interval '95 hours', '${PACIENTE_1}', 'no_show', null),
      ('${s(4)}', '${ORG_A}', '${TIPO_A}', 'S4', now() - interval '5 days', now() - interval '119 hours', '${PACIENTE_1}', 'cancelled', now() - interval '6 days'),
      ('${s(5)}', '${ORG_A}', '${TIPO_A}', 'S5', now() + interval '2 days', now() + interval '49 hours', '${PACIENTE_1}', 'confirmed', null),
      ('${s(6)}', '${ORG_A}', '${TIPO_A}', 'S6', now() - interval '60 days', now() - interval '1439 hours', '${PACIENTE_1}', 'completed', null),
      ('${s(7)}', '${ORG_A}', '${TIPO_SEM_MODALIDADE}', 'Reunião', now() - interval '1 day', now() - interval '23 hours', null, 'completed', null),
      ('${s(8)}', '${ORG_B}', '${TIPO_B}', 'SB', now() - interval '1 day', now() - interval '23 hours', '${PACIENTE_B}', 'completed', null)
      on conflict (id) do nothing;

    insert into public.clinica_pacotes
      (id, organization_id, contact_id, nome, modalidade, sessoes_total, valor_cents, valido_ate,
       aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas)
    values
      ('${PACOTE}', '${ORG_A}', '${PACIENTE_1}', 'Fisio 10', 'fisioterapia', 10, 150000, now() + interval '60 days', now(), 30, 24)
      on conflict (id) do nothing;
    insert into public.clinica_pacote_consumos (organization_id, pacote_id, appointment_id, motivo, sessao_em)
    values ('${ORG_A}', '${PACOTE}', '${s(1)}', 'realizada', now() - interval '2 days')
      on conflict (appointment_id) do nothing;

    insert into public.clinica_multas
      (organization_id, appointment_id, contact_id, percentual, antecedencia_horas, valor_cents, status)
    values ('${ORG_A}', '${s(4)}', '${PACIENTE_1}', 30, 2, 3600, 'pendente')
      on conflict (appointment_id) do nothing;
  `);
});

const relatorio = (org: string, campo: string) =>
  sql(`select public.fn_clinica_relatorio_gestao('${org}', ${JANELA}) #>> '{${campo}}';`).trim();

describe("relatório da gestão: quem alcança", () => {
  it("nenhuma das funções é alcançável pela sessão nem pela anon key", () => {
    for (const nome of [
      "fn_clinica_relatorio_gestao",
      "fn_clinica_exportar_sessoes",
      "fn_clinica_exportar_pacotes",
      "fn_clinica_exportar_multas",
    ]) {
      const fn = `public.${nome}(uuid, timestamptz, timestamptz)`;
      expect(
        sql(
          `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
        ).trim(),
        nome,
      ).toBe("false/false/true");
    }
  });
});

describe("relatório da gestão: os números", () => {
  it("conta cada sessão da clínica uma vez, pela situação, só no período", () => {
    expect(relatorio(ORG_A, "sessoes,marcadas")).toBe("5");
    expect(relatorio(ORG_A, "sessoes,realizadas")).toBe("2");
    expect(relatorio(ORG_A, "sessoes,faltas")).toBe("1");
    expect(relatorio(ORG_A, "sessoes,canceladas")).toBe("1");
    expect(relatorio(ORG_A, "sessoes,em_aberto")).toBe("1");
    expect(relatorio(ORG_A, "sessoes,pacientes_atendidos")).toBe("2");
  });

  it("avulsa é a realizada que não gastou pacote, a preço de tabela", () => {
    expect(relatorio(ORG_A, "sessoes,avulsas_realizadas")).toBe("1");
    expect(relatorio(ORG_A, "sessoes,avulsas_valor_tabela_cents")).toBe("12000");
  });

  it("pacotes vendidos, multas e pacientes novos do período", () => {
    expect(relatorio(ORG_A, "pacotes,vendidos")).toBe("1");
    expect(relatorio(ORG_A, "pacotes,vendidos_valor_cents")).toBe("150000");
    expect(relatorio(ORG_A, "multas,pendentes_valor_cents")).toBe("3600");
    expect(relatorio(ORG_A, "pacientes_novos")).toBe("1");
  });

  it("uma clínica não entra no relatório nem na exportação da outra", () => {
    expect(relatorio(ORG_B, "sessoes,marcadas")).toBe("1");
    expect(relatorio(ORG_B, "pacotes,vendidos")).toBe("0");
    expect(
      sql(
        `select count(*) from public.fn_clinica_exportar_sessoes('${ORG_A}', ${JANELA}) where id = '${s(8)}';`,
      ).trim(),
    ).toBe("0");
    expect(
      sql(`select count(*) from public.fn_clinica_exportar_sessoes('${ORG_A}', ${JANELA});`).trim(),
    ).toBe("5");
    expect(
      sql(`select count(*) from public.fn_clinica_exportar_multas('${ORG_B}', ${JANELA});`).trim(),
    ).toBe("0");
  });

  it("a exportação de sessões diz quem gastou pacote", () => {
    expect(
      sql(
        `select do_pacote from public.fn_clinica_exportar_sessoes('${ORG_A}', ${JANELA}) where id = '${s(1)}';`,
      ).trim(),
    ).toBe("t");
  });
});
