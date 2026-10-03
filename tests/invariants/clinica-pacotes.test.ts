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
 * OS PACOTES DE SESSÕES NO BANCO (migration 9004, fork TOQ).
 *
 * O que só o banco garante: ninguém fabrica nem apaga pacote ou sessão gasta pela API do
 * Supabase (só o servidor escreve); uma clínica não vê o pacote da outra; "Somente leitura" não
 * vê valor; e o saldo nunca passa do total, nem com duas sessões marcadas ao mesmo tempo. A
 * conta de reembolso e o valor da sessão dentro do pacote são do servidor e têm teste unitário
 * em `lib/clinica/pacotes.test.ts`.
 */
const ORG_B = "cccccccc-9004-4000-8000-0000000000b0";
const CONTATO_B = "cccccccc-9004-4000-8000-0000000000b1";
const TIPO_FISIO = "cccccccc-9004-4000-8000-0000000000a2";
const PACOTE_A = "cccccccc-9004-4000-8000-0000000000a4";
const PACOTE_VENCIDO = "cccccccc-9004-4000-8000-0000000000a5";
/** Válido e com saldo, de OUTRO paciente: não disputa as sessões do primeiro. */
const PACOTE_C = "cccccccc-9004-4000-8000-0000000000a6";
const PACOTE_B = "cccccccc-9004-4000-8000-0000000000b4";
const SESSAO_B = "cccccccc-9004-4000-8000-0000000000b3";
const sessao = (n: number) => `cccccccc-9004-4000-8000-0000000001${String(n).padStart(2, "0")}`;

function erroComoDono(comando: string): string {
  try {
    sql(`${comando};`);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

function consumir(appointment: string, motivo: "realizada" | "falta" | null, org = GOV_ORG): string {
  return sql(
    `select coalesce(string_agg(coalesce(pacote_id::text, '') || '|' || coalesce(saldo::text, '') || '|' || acao, ','), '')
       from public.fn_clinica_consumir_sessao('${org}', '${appointment}', 'fisioterapia', ${
         motivo ? `'${motivo}'` : "null"
       });`,
  ).trim();
}

function saldo(pacote: string): number {
  return Number(
    sql(
      `select p.sessoes_total - (select count(*) from public.clinica_pacote_consumos c where c.pacote_id = p.id)
         from public.clinica_pacotes p where p.id = '${pacote}';`,
    ).trim(),
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    select public.fn_clinica_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_B}', 'clinica-pacotes-b', 'Clinica Pacotes B', 'Clin Pacotes B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;
    insert into public.calendar_event_types (id, organization_id, name, slug) values
      ('${TIPO_FISIO}', '${GOV_ORG}', 'Fisio pacote', 'fisio-pacote-9004')
      on conflict (id) do nothing;

    -- Doze sessões passadas do mesmo paciente (o pacote tem 10).
    insert into public.calendar_appointments (id, organization_id, event_type_id, title, starts_at, ends_at, contact_id)
    select ('cccccccc-9004-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, '${GOV_ORG}', '${TIPO_FISIO}',
           'Sessão ' || n, now() - make_interval(days => 13 - n), now() - make_interval(days => 13 - n) + interval '1 hour',
           '${GOV_CONTACT_1}'
      from generate_series(1, 12) n
    on conflict (id) do nothing;
    insert into public.calendar_appointments (id, organization_id, title, starts_at, ends_at, contact_id)
    values ('${SESSAO_B}', '${ORG_B}', 'Sessão B', now() - interval '1 day', now() - interval '23 hours', '${CONTATO_B}')
    on conflict (id) do nothing;

    -- Pacotes semeados pelo dono (como o servidor faria).
    insert into public.clinica_pacotes
      (id, organization_id, contact_id, nome, modalidade, sessoes_total, valor_cents, comprado_em, valido_ate,
       aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas)
    values
      ('${PACOTE_A}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'Pacote 10 fisio', 'fisioterapia', 10, 150000,
       now() - interval '20 days', now() + interval '40 days', now() - interval '20 days', 30, 24),
      ('${PACOTE_VENCIDO}', '${GOV_ORG}', '${GOV_CONTACT_1}', 'Pacote antigo', 'fisioterapia', 10, null,
       now() - interval '90 days', now() - interval '30 days', now() - interval '90 days', 30, 24),
      ('${PACOTE_C}', '${GOV_ORG}', '${GOV_CONTACT_2}', 'Pacote C', 'fisioterapia', 10, 150000,
       now() - interval '1 day', now() + interval '59 days', now() - interval '1 day', 30, 24),
      ('${PACOTE_B}', '${ORG_B}', '${CONTATO_B}', 'Pacote B', 'fisioterapia', 10, 99000,
       now() - interval '5 days', now() + interval '55 days', now() - interval '5 days', 30, 24)
    on conflict (id) do nothing;
  `);
});

describe("pacotes: quem vê e quem escreve", () => {
  it("ninguém cria, altera ou apaga pacote pela sessão, nem o administrador", () => {
    for (const quem of [GOV_AGENT_A, GOV_MANAGER, GOV_ADMIN]) {
      expect(
        writeCountAs(
          quem,
          `insert into public.clinica_pacotes (organization_id, contact_id, nome, modalidade, sessoes_total, valido_ate, aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas)
           values ('${GOV_ORG}', '${GOV_CONTACT_1}', 'Fabricado', 'fisioterapia', 100, now() + interval '1 year', now(), 0, 0)`,
        ),
      ).toBe(0);
      expect(
        writeCountAs(quem, `update public.clinica_pacotes set sessoes_total = 100 where id = '${PACOTE_A}'`),
      ).toBe(0);
      expect(writeCountAs(quem, `delete from public.clinica_pacote_consumos`)).toBe(0);
    }
  });

  it("a recepção vê o pacote da própria clínica; Somente leitura não vê valor nenhum", () => {
    expect(countAs(GOV_AGENT_A, `select count(*) from public.clinica_pacotes;`)).toBe(3);
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_pacotes;`)).toBe(0);
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_produtos;`)).toBe(0);
  });

  it("uma clínica não vê o pacote da outra", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_pacotes where id = '${PACOTE_B}';`)).toBe(0);
  });

  it("só o administrador cadastra o pacote no catálogo", () => {
    const novo = (nome: string) =>
      `insert into public.clinica_produtos (organization_id, nome, modalidade, sessoes, validade_dias) values ('${GOV_ORG}', '${nome}', 'pilates', 10, 60)`;
    expect(writeCountAs(GOV_AGENT_A, novo("Pilates recepção"))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, novo("Pilates gerente"))).toBe(0);
    expect(writeCountAs(GOV_ADMIN, novo("Pilates 10"))).toBe(1);
  });

  it("o catálogo aceita pacote sem preço (a clínica ainda não definiu os valores)", () => {
    expect(
      sql(`select count(*) from public.clinica_produtos where nome = 'Pilates 10' and valor_cents is null;`).trim(),
    ).toBe("1");
  });

  it("as funções de pacote não são alcançáveis pela sessão nem pela anon key", () => {
    for (const fn of [
      "public.fn_clinica_consumir_sessao(uuid, uuid, text, text)",
      "public.fn_clinica_ajustar_pacote(uuid, uuid, text, int, text, bigint, uuid)",
      "public.fn_clinica_provisionar_pacotes()",
    ]) {
      expect(
        sql(
          `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
        ).trim(),
      ).toBe("false/false/true");
    }
  });
});

describe("pacotes: saldo", () => {
  it("sessão realizada e falta gastam; o pacote vencido não é usado", () => {
    expect(consumir(sessao(1), "realizada")).toBe(`${PACOTE_A}|9|lancada`);
    expect(consumir(sessao(2), "falta")).toBe(`${PACOTE_A}|8|lancada`);
    expect(saldo(PACOTE_VENCIDO)).toBe(10);
  });

  it("marcar de novo a mesma sessão não gasta duas vezes, e trocar o desfecho só troca o motivo", () => {
    expect(consumir(sessao(1), "realizada")).toBe(`${PACOTE_A}|8|ja_lancada`);
    expect(consumir(sessao(1), "falta")).toBe(`${PACOTE_A}|8|ja_lancada`);
    expect(
      sql(`select motivo from public.clinica_pacote_consumos where appointment_id = '${sessao(1)}';`).trim(),
    ).toBe("falta");
  });

  it("a sessão que deixa de contar volta para o saldo", () => {
    expect(consumir(sessao(2), null)).toBe(`${PACOTE_A}|9|estornada`);
    expect(consumir(sessao(2), null)).toBe("");
  });

  it("o saldo nunca passa do total: a 11ª sessão é avulsa", () => {
    for (let n = 2; n <= 10; n += 1) consumir(sessao(n), "realizada");
    expect(saldo(PACOTE_A)).toBe(0);
    expect(consumir(sessao(11), "realizada")).toBe("");
    expect(sql(`select count(*) from public.clinica_pacote_consumos where pacote_id = '${PACOTE_A}';`).trim()).toBe(
      "10",
    );
  });

  it("sessão de outra clínica é recusada, mesmo pelo servidor", () => {
    expect(erroComoDono(`select * from public.fn_clinica_consumir_sessao('${GOV_ORG}', '${SESSAO_B}', 'fisioterapia', 'realizada')`)).toMatch(
      /clinica_sessao_de_outra_organizacao/,
    );
    expect(saldo(PACOTE_B)).toBe(10);
  });
});

describe("pacotes: congelar, prorrogar e cancelar", () => {
  const ajustar = (
    pacote: string,
    tipo: string,
    dias: number | null,
    motivo = "motivo do teste",
    valor: number | null = null,
  ) =>
    `select public.fn_clinica_ajustar_pacote('${GOV_ORG}', '${pacote}', '${tipo}', ${dias ?? "null"}, '${motivo}', ${valor ?? "null"}, null)`;

  it("congelamento acima do máximo das Regras é recusado, e pacote vencido não congela", () => {
    expect(erroComoDono(ajustar(PACOTE_C, "congelamento", 31))).toMatch(/clinica_congelamento_acima_do_maximo/);
    expect(erroComoDono(ajustar(PACOTE_VENCIDO, "congelamento", 10))).toMatch(/clinica_pacote_vencido/);
  });

  it("congela uma vez só, e a validade anda os dias congelados", () => {
    const antes = sql(`select valido_ate from public.clinica_pacotes where id = '${PACOTE_C}';`).trim();
    expect(erroComoDono(ajustar(PACOTE_C, "congelamento", 20))).toBe("");
    expect(
      sql(
        `select (valido_ate - '${antes}'::timestamptz) = interval '20 days' from public.clinica_pacotes where id = '${PACOTE_C}';`,
      ).trim(),
    ).toBe("t");
    expect(erroComoDono(ajustar(PACOTE_C, "congelamento", 5))).toMatch(/clinica_pacote_ja_congelado/);
  });

  it("prorrogar um pacote vencido conta a partir de hoje", () => {
    expect(erroComoDono(ajustar(PACOTE_VENCIDO, "prorrogacao", 15, "atestado médico"))).toBe("");
    expect(
      sql(
        `select valido_ate between now() + interval '14 days' and now() + interval '16 days' from public.clinica_pacotes where id = '${PACOTE_VENCIDO}';`,
      ).trim(),
    ).toBe("t");
  });

  it("cancelar guarda motivo e reembolso sugerido; o cancelado não gasta mais e o prorrogado volta a valer", () => {
    expect(erroComoDono(ajustar(PACOTE_C, "cancelamento", null, "mudou de cidade", 30000))).toBe("");
    expect(
      sql(`select status || '/' || cancelamento_motivo from public.clinica_pacotes where id = '${PACOTE_C}';`).trim(),
    ).toBe("cancelado/mudou de cidade");
    expect(
      sql(
        `select string_agg(tipo || ':' || coalesce(valor_cents::text, '-'), ',' order by registrado_em) from public.clinica_pacote_eventos where pacote_id = '${PACOTE_C}';`,
      ).trim(),
    ).toBe("congelamento:-,cancelamento:30000");
    expect(erroComoDono(ajustar(PACOTE_C, "prorrogacao", 10))).toMatch(/clinica_pacote_cancelado/);
    expect(consumir(sessao(12), "realizada")).toBe(`${PACOTE_VENCIDO}|9|lancada`);
  });

  it("cancelamento sem motivo é recusado pelo banco", () => {
    expect(
      erroComoDono(
        `update public.clinica_pacotes set status = 'cancelado', cancelado_em = now(), cancelamento_motivo = null where id = '${PACOTE_A}'`,
      ),
    ).toMatch(/check constraint/);
  });
});
