import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  seedGov,
  sql,
  tableExists,
  writeCountAs,
} from "./gov-helpers";

/**
 * O PAINEL FINANCEIRO NO BANCO (migration 9012, fork TOQ).
 *
 * O que só o banco garante: `clinica_despesas` nasce quando a clínica é instalada (não no
 * baseline); só `manager`+ lê as saídas e ninguém as escreve pela API do Supabase; as funções do
 * painel não são alcançáveis pela sessão; e as contas batem: entrou = pagamentos do período,
 * saiu = despesas do período, a receber = pacote ativo, avulsa realizada e multa pendente sem
 * pagamento. Pacote cancelado, sessão que gastou pacote, multa isenta e o que é de outra clínica
 * ou de fora do período não entram. E a previsão: sessão marcada de agora até o fim do período,
 * pelo preço de tabela, fora a que o saldo de um pacote ativo vai cobrir e a já paga.
 */
const ORG = "cccccccc-9012-4000-8000-000000000000";
const ORG_B = "cccccccc-9012-4000-8000-0000000000b0";
const PACIENTE = "cccccccc-9012-4000-8000-000000000001";
const PACIENTE_B = "cccccccc-9012-4000-8000-0000000000b1";
const TIPO = "cccccccc-9012-4000-8000-000000000002";
const PACOTE_PAGO = "cccccccc-9012-4000-8000-000000000010";
const PACOTE_ABERTO = "cccccccc-9012-4000-8000-000000000011";
const PACOTE_CANCELADO = "cccccccc-9012-4000-8000-000000000012";
const PACOTE_ANTIGO = "cccccccc-9012-4000-8000-000000000013";
const AVULSA_ABERTA = "cccccccc-9012-4000-8000-000000000020";
const AVULSA_PAGA = "cccccccc-9012-4000-8000-000000000021";
const DO_PACOTE = "cccccccc-9012-4000-8000-000000000022";
const FALTOU = "cccccccc-9012-4000-8000-000000000023";
const FALTOU_ISENTA = "cccccccc-9012-4000-8000-000000000024";
const MULTA_ABERTA = "cccccccc-9012-4000-8000-000000000030";
const MULTA_ISENTA = "cccccccc-9012-4000-8000-000000000031";
const DESPESA_B = "cccccccc-9012-4000-8000-0000000000b2";
const PACIENTE_PREV = "cccccccc-9012-4000-8000-000000000003";
const PACOTE_PREV = "cccccccc-9012-4000-8000-000000000014";
const PREV_FEITA = "cccccccc-9012-4000-8000-000000000040";
const PREV_1 = "cccccccc-9012-4000-8000-000000000041";
const PREV_2 = "cccccccc-9012-4000-8000-000000000042";
const PREV_PAGA = "cccccccc-9012-4000-8000-000000000043";
const PREV_LONGE = "cccccccc-9012-4000-8000-000000000044";
const PREV_CANCELADA = "cccccccc-9012-4000-8000-000000000045";
const PREV_ATRASADA = "cccccccc-9012-4000-8000-000000000046";

const DE = "2026-10-01T03:00:00Z";
const ATE = "2026-11-01T03:00:00Z";

let tabelaAntes = true;

function erroComoDono(comando: string): string {
  try {
    sql(`${comando};`);
    return "";
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? String(err);
  }
}

const resumo = (org = ORG) =>
  JSON.parse(
    sql(`select public.fn_clinica_financeiro_resumo('${org}', '${DE}', '${ATE}')::text;`),
  ) as {
    entradas: { qtd: number; total_cents: number; por_forma: { forma: string }[] };
    saidas: { qtd: number; total_cents: number };
    a_receber: { qtd: number; total_cents: number; sem_valor: number };
    previsao: { qtd: number; total_cents: number; sem_valor: number; cobertas_por_pacote: number };
  };

beforeAll(() => {
  seedGov();
  tabelaAntes = tableExists("clinica_despesas");
  sql(`
    select public.fn_clinica_provisionar();

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG}', 'clinica-financeiro', 'Clinica Financeiro', 'Clin Financeiro'),
      ('${ORG_B}', 'clinica-financeiro-b', 'Clinica Financeiro B', 'Clin Financeiro B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name) values
      ('${PACIENTE}', '${ORG}', 'Paciente do caixa'),
      ('${PACIENTE_B}', '${ORG_B}', 'Paciente B')
      on conflict (id) do nothing;

    insert into public.calendar_event_types (id, organization_id, name, slug, default_price_cents)
    values ('${TIPO}', '${ORG}', 'Fisioterapia', 'fisio-caixa', 20000)
    on conflict (id) do nothing;
    insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade)
    values ('${ORG}', '${TIPO}', 'fisioterapia')
    on conflict do nothing;

    insert into public.clinica_pacotes
      (id, organization_id, contact_id, nome, modalidade, sessoes_total, valor_cents, comprado_em,
       valido_ate, aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas, status,
       cancelado_em, cancelamento_motivo)
    values
      ('${PACOTE_PAGO}', '${ORG}', '${PACIENTE}', 'Pacote pago', 'fisioterapia', 10, 150000,
       '2026-10-05T12:00:00Z', '2026-12-05T12:00:00Z', '2026-10-05T12:00:00Z', 30, 24, 'ativo', null, null),
      ('${PACOTE_ABERTO}', '${ORG}', '${PACIENTE}', 'Pacote em aberto', 'fisioterapia', 10, 120000,
       '2026-10-06T12:00:00Z', '2026-12-06T12:00:00Z', '2026-10-06T12:00:00Z', 30, 24, 'ativo', null, null),
      ('${PACOTE_CANCELADO}', '${ORG}', '${PACIENTE}', 'Pacote cancelado', 'fisioterapia', 10, 90000,
       '2026-10-07T12:00:00Z', '2026-12-07T12:00:00Z', '2026-10-07T12:00:00Z', 30, 24, 'cancelado',
       '2026-10-08T12:00:00Z', 'Desistiu'),
      ('${PACOTE_ANTIGO}', '${ORG}', '${PACIENTE}', 'Pacote de setembro', 'fisioterapia', 10, 80000,
       '2026-09-10T12:00:00Z', '2026-11-10T12:00:00Z', '2026-09-10T12:00:00Z', 30, 24, 'ativo', null, null)
    on conflict (id) do nothing;

    insert into public.calendar_appointments
      (id, organization_id, event_type_id, title, starts_at, ends_at, contact_id, status)
    values
      ('${AVULSA_ABERTA}', '${ORG}', '${TIPO}', 'Fisio', '2026-10-10T13:00:00Z', '2026-10-10T14:00:00Z', '${PACIENTE}', 'completed'),
      ('${AVULSA_PAGA}', '${ORG}', '${TIPO}', 'Fisio', '2026-10-11T13:00:00Z', '2026-10-11T14:00:00Z', '${PACIENTE}', 'completed'),
      ('${DO_PACOTE}', '${ORG}', '${TIPO}', 'Fisio', '2026-10-12T13:00:00Z', '2026-10-12T14:00:00Z', '${PACIENTE}', 'completed'),
      ('${FALTOU}', '${ORG}', '${TIPO}', 'Fisio', '2026-10-13T13:00:00Z', '2026-10-13T14:00:00Z', '${PACIENTE}', 'no_show'),
      ('${FALTOU_ISENTA}', '${ORG}', '${TIPO}', 'Fisio', '2026-10-14T13:00:00Z', '2026-10-14T14:00:00Z', '${PACIENTE}', 'no_show')
    on conflict (id) do nothing;

    insert into public.clinica_pacote_consumos (organization_id, pacote_id, appointment_id, motivo, sessao_em)
    values ('${ORG}', '${PACOTE_PAGO}', '${DO_PACOTE}', 'realizada', '2026-10-12T13:00:00Z')
    on conflict do nothing;

    insert into public.clinica_multas
      (id, organization_id, appointment_id, contact_id, percentual, antecedencia_horas, valor_cents,
       origem, status, isencao_motivo, isenta_em, created_at)
    values
      ('${MULTA_ABERTA}', '${ORG}', '${FALTOU}', '${PACIENTE}', 30, -0.5, 6000, 'falta',
       'pendente', null, null, '2026-10-13T15:00:00Z'),
      ('${MULTA_ISENTA}', '${ORG}', '${FALTOU_ISENTA}', '${PACIENTE}', 30, -0.5, 6000, 'falta',
       'isenta', 'Atestado', '2026-10-14T15:00:00Z', '2026-10-14T15:00:00Z')
    on conflict (id) do nothing;

    insert into public.clinica_pagamentos (organization_id, contact_id, pacote_id, forma, valor_cents, pago_em)
    values ('${ORG}', '${PACIENTE}', '${PACOTE_PAGO}', 'pix', 150000, '2026-10-05T13:00:00Z')
    on conflict do nothing;
    insert into public.clinica_pagamentos (organization_id, contact_id, appointment_id, forma, valor_cents, pago_em)
    values ('${ORG}', '${PACIENTE}', '${AVULSA_PAGA}', 'dinheiro', 18000, '2026-10-11T15:00:00Z')
    on conflict do nothing;

    insert into public.clinica_despesas (organization_id, descricao, categoria, forma, valor_cents, pago_em)
    select '${ORG}', 'Aluguel de outubro', 'aluguel', 'boleto', 300000, '2026-10-05T15:00:00Z'
     where not exists (select 1 from public.clinica_despesas where organization_id = '${ORG}');
    insert into public.clinica_despesas (organization_id, descricao, categoria, forma, valor_cents, pago_em)
    select '${ORG}', 'Aluguel de setembro', 'aluguel', 'boleto', 300000, '2026-09-05T15:00:00Z'
     where not exists (select 1 from public.clinica_despesas
                        where organization_id = '${ORG}' and descricao = 'Aluguel de setembro');
    insert into public.clinica_despesas (id, organization_id, descricao, categoria, forma, valor_cents, pago_em)
    values ('${DESPESA_B}', '${ORG_B}', 'Aluguel B', 'aluguel', 'pix', 999900, '2026-10-05T15:00:00Z')
    on conflict (id) do nothing;
  `);
});

describe("financeiro: a provisionadora", () => {
  it("a tabela das despesas não está no baseline: nasce quando a clínica é instalada", () => {
    expect(tabelaAntes, "clinica_despesas existia antes de provisionar (ADR-0002 D2)").toBe(false);
    expect(tableExists("clinica_despesas")).toBe(true);
  });

  it("a provisionadora da interface chama a das despesas, e provisionar de novo não apaga nada", () => {
    expect(
      sql(
        `select position('fn_clinica_provisionar_despesas' in p.prosrc) > 0
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'fn_clinica_provisionar_interface';`,
      ),
    ).toBe("t");
    sql(`select public.fn_clinica_provisionar();`);
    expect(
      sql(`select count(*) from public.clinica_despesas where organization_id = '${ORG}';`),
    ).toBe("2");
  });

  it("nenhuma função do painel é alcançável pela sessão nem pela anon key", () => {
    for (const fn of [
      "public.fn_clinica_provisionar_despesas()",
      "public.fn_clinica_financeiro_resumo(uuid, timestamptz, timestamptz)",
      "public.fn_clinica_financeiro_entradas(uuid, timestamptz, timestamptz)",
      "public.fn_clinica_financeiro_a_receber(uuid, timestamptz, timestamptz)",
    ]) {
      expect(
        sql(
          `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
        ),
        fn,
      ).toBe("false/false/true");
    }
  });
});

describe("financeiro: as contas do período", () => {
  it("entrou = os pagamentos do período", () => {
    const r = resumo();
    expect(r.entradas.qtd).toBe(2);
    expect(r.entradas.total_cents).toBe(168000);
    expect(r.entradas.por_forma.map((f) => f.forma).sort()).toEqual(["dinheiro", "pix"]);
  });

  it("saiu = as despesas do período, só desta clínica", () => {
    const r = resumo();
    expect(r.saidas.qtd).toBe(1);
    expect(r.saidas.total_cents).toBe(300000);
  });

  it("a receber = pacote ativo, avulsa realizada e multa pendente, sem pagamento", () => {
    const itens = sql(
      `select string_agg(tipo || ':' || id || ':' || coalesce(valor_cents::text, '-'), ',' order by tipo, id)
         from public.fn_clinica_financeiro_a_receber('${ORG}', '${DE}', '${ATE}');`,
    );
    expect(itens).toBe(
      [
        `multa:${MULTA_ABERTA}:6000`,
        `pacote:${PACOTE_ABERTO}:120000`,
        `sessao:${AVULSA_ABERTA}:20000`,
      ].join(","),
    );
    const r = resumo();
    expect(r.a_receber.qtd).toBe(3);
    expect(r.a_receber.total_cents).toBe(146000);
    expect(r.a_receber.sem_valor).toBe(0);
  });

  it("pagar o pacote em aberto tira da lista e põe nas entradas", () => {
    sql(`
      insert into public.clinica_pagamentos (organization_id, contact_id, pacote_id, forma, valor_cents, pago_em)
      values ('${ORG}', '${PACIENTE}', '${PACOTE_ABERTO}', 'cartao_credito', 120000, '2026-10-20T15:00:00Z')
      on conflict do nothing;`);
    const r = resumo();
    expect(r.a_receber.qtd).toBe(2);
    expect(r.entradas.total_cents).toBe(288000);
    expect(
      sql(
        `select count(*) from public.fn_clinica_financeiro_entradas('${ORG}', '${DE}', '${ATE}')
          where tipo = 'pacote' and descricao = 'Pacote em aberto' and contato_display_name = 'Paciente do caixa';`,
      ),
    ).toBe("1");
  });
});

describe("financeiro: a previsão pela agenda", () => {
  // As sessões futuras são relativas a now(): a previsão olha de agora em diante.
  const em = (dias: number) => `now() + interval '${dias} days'`;
  const previsao = (de = em(-1), ate = em(60)) =>
    sql(
      `select string_agg(id || ':' || coberta_por_pacote || ':' || coalesce(valor_cents::text, '-'), ',' order by starts_at)
         from public.fn_clinica_financeiro_previsao('${ORG}', ${de}, ${ate})
        where contact_id = '${PACIENTE_PREV}';`,
    );

  beforeAll(() => {
    sql(`
      insert into public.contacts (id, organization_id, display_name)
      values ('${PACIENTE_PREV}', '${ORG}', 'Paciente da agenda') on conflict (id) do nothing;
      insert into public.clinica_pacotes
        (id, organization_id, contact_id, nome, modalidade, sessoes_total, valor_cents, comprado_em,
         valido_ate, aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas, status)
      values ('${PACOTE_PREV}', '${ORG}', '${PACIENTE_PREV}', 'Pacote de 2', 'fisioterapia', 2, 36000,
              ${em(-10)}, ${em(30)}, ${em(-10)}, 30, 24, 'ativo')
      on conflict (id) do nothing;
      insert into public.calendar_appointments
        (id, organization_id, event_type_id, title, starts_at, ends_at, contact_id, status)
      values
        ('${PREV_FEITA}', '${ORG}', '${TIPO}', 'Fisio', ${em(-5)}, ${em(-5)} + interval '1 hour', '${PACIENTE_PREV}', 'completed'),
        ('${PREV_1}', '${ORG}', '${TIPO}', 'Fisio', ${em(1)}, ${em(1)} + interval '1 hour', '${PACIENTE_PREV}', 'pending'),
        ('${PREV_2}', '${ORG}', '${TIPO}', 'Fisio', ${em(2)}, ${em(2)} + interval '1 hour', '${PACIENTE_PREV}', 'confirmed'),
        ('${PREV_PAGA}', '${ORG}', '${TIPO}', 'Fisio', ${em(3)}, ${em(3)} + interval '1 hour', '${PACIENTE_PREV}', 'pending'),
        ('${PREV_LONGE}', '${ORG}', '${TIPO}', 'Fisio', ${em(40)}, ${em(40)} + interval '1 hour', '${PACIENTE_PREV}', 'pending'),
        ('${PREV_ATRASADA}', '${ORG}', '${TIPO}', 'Fisio', ${em(-2)}, ${em(-2)} + interval '1 hour', '${PACIENTE_PREV}', 'pending')
      on conflict (id) do nothing;
      insert into public.calendar_appointments
        (id, organization_id, event_type_id, title, starts_at, ends_at, contact_id, status, cancelled_at)
      values ('${PREV_CANCELADA}', '${ORG}', '${TIPO}', 'Fisio', ${em(4)}, ${em(4)} + interval '1 hour', '${PACIENTE_PREV}', 'cancelled', now())
      on conflict (id) do nothing;
      insert into public.clinica_pacote_consumos (organization_id, pacote_id, appointment_id, motivo, sessao_em)
      values ('${ORG}', '${PACOTE_PREV}', '${PREV_FEITA}', 'realizada', ${em(-5)})
      on conflict do nothing;
      insert into public.clinica_pagamentos (organization_id, contact_id, appointment_id, forma, valor_cents, pago_em)
      values ('${ORG}', '${PACIENTE_PREV}', '${PREV_PAGA}', 'pix', 20000, now())
      on conflict do nothing;
    `);
  });

  it("a sessão marcada vale o preço de tabela; o saldo do pacote cobre a próxima e só ela", () => {
    expect(previsao()).toBe(
      [`${PREV_1}:true:0`, `${PREV_2}:false:20000`, `${PREV_LONGE}:false:20000`].join(","),
    );
  });

  it("o saldo é gasto pela ordem da agenda, mesmo quando o período começa depois", () => {
    expect(previsao(`now() + interval '36 hours'`)).toBe(
      [`${PREV_2}:false:20000`, `${PREV_LONGE}:false:20000`].join(","),
    );
  });

  it("o resumo soma só o que o pacote não cobre e conta as cobertas à parte", () => {
    const r = JSON.parse(
      sql(`select public.fn_clinica_financeiro_resumo('${ORG}', ${em(-1)}, ${em(60)})::text;`),
    ) as {
      previsao: {
        qtd: number;
        total_cents: number;
        sem_valor: number;
        cobertas_por_pacote: number;
      };
    };
    expect(r.previsao).toEqual({
      qtd: 2,
      total_cents: 40000,
      sem_valor: 0,
      cobertas_por_pacote: 1,
    });
  });

  it("a previsão não é alcançável pela sessão nem pela anon key", () => {
    const fn = "public.fn_clinica_financeiro_previsao(uuid, timestamptz, timestamptz)";
    expect(
      sql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
      ),
    ).toBe("false/false/true");
  });
});

describe("financeiro: o que o banco recusa e quem lê", () => {
  it("despesa tem valor positivo, categoria e forma conhecidas", () => {
    const base = `insert into public.clinica_despesas (organization_id, descricao, categoria, forma, valor_cents)`;
    expect(erroComoDono(`${base} values ('${ORG}', 'Zero', 'outros', 'pix', 0)`)).toMatch(/check/i);
    expect(erroComoDono(`${base} values ('${ORG}', 'Luz', 'energia', 'pix', 100)`)).toMatch(
      /check/i,
    );
    expect(erroComoDono(`${base} values ('${ORG}', 'Luz', 'contas', 'cheque', 100)`)).toMatch(
      /check/i,
    );
  });

  it("só Gerente para cima lê as saídas; a recepção não; outra clínica não aparece", () => {
    sql(`
      insert into public.clinica_despesas (organization_id, descricao, categoria, forma, valor_cents)
      select '${GOV_ORG}', 'Material de pilates', 'materiais', 'pix', 45000
       where not exists (select 1 from public.clinica_despesas where organization_id = '${GOV_ORG}');`);
    expect(countAs(GOV_MANAGER, `select count(*) from public.clinica_despesas;`)).toBe(1);
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_despesas;`)).toBe(1);
    expect(countAs(GOV_AGENT_A, `select count(*) from public.clinica_despesas;`)).toBe(0);
  });

  it("ninguém lança, muda ou apaga despesa pela API do Supabase: só o servidor", () => {
    expect(
      writeCountAs(
        GOV_ADMIN,
        `insert into public.clinica_despesas (organization_id, descricao, categoria, forma, valor_cents) values ('${GOV_ORG}', 'Fraude', 'outros', 'pix', 1)`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `update public.clinica_despesas set valor_cents = 1 where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_ADMIN,
        `delete from public.clinica_despesas where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
  });
});
