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
 * AS REGRAS DA AGENDA DA CLÍNICA QUE MORAM NO BANCO (migration 9002, fork TOQ).
 *
 * O PostgREST fala com o JWT da sessão sem passar por rota nenhuma. Então "a recepção não muda a
 * política de faltas", "ninguém fabrica uma multa" e "ninguém apaga o histórico da sessão" só
 * valem se a RLS disser. O que a regra de negócio decide (multa sim ou não, falta antes da
 * tolerância) é do servidor e tem teste unitário em `lib/clinica/agenda.test.ts`.
 *
 * Elenco (seedGov): GOV_AGENT_A é recepção (`agent`), GOV_MANAGER gestão, GOV_ADMIN admin.
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

    insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade, valor_cents)
    values ('${ORG_B}', '${TIPO_B}', 'pilates', 9000)
      on conflict (organization_id, event_type_id) do nothing;

    -- Linhas que só o servidor escreve, semeadas pelo dono (como o service_role faria).
    insert into public.clinica_multas
      (organization_id, appointment_id, contact_id, percentual, antecedencia_horas, valor_cents)
    values ('${ORG_B}', '${SESSAO_B}', '${CONTATO_B}', 30, 3.5, 2700)
      on conflict (appointment_id) do nothing;
    insert into public.clinica_agenda_historico
      (organization_id, appointment_id, acao, de_inicio, para_inicio, por_tipo)
    values ('${ORG_B}', '${SESSAO_B}', 'remarcado', now(), now() + interval '1 day', 'ai');
  `);
});

describe("política de faltas", () => {
  it("só gestão grava a política; a recepção não", () => {
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
    ).toBe(1);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.clinica_politicas set multa_cancelamento_pct = 0 where organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
  });

  it("todo membro lê a política da própria clínica, e só dela", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_politicas;`)).toBe(1);
  });

  it("valores fora da faixa são recusados", () => {
    expect(
      erroComoDono(
        `update public.clinica_politicas set multa_cancelamento_pct = 150 where organization_id = '${GOV_ORG}'`,
      ),
    ).toMatch(/check constraint/);
  });
});

describe("modalidade dos tipos de atendimento", () => {
  it("gestão etiqueta tipo da própria clínica; recepção não", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade) values ('${GOV_ORG}', '${TIPO_A}', 'fisioterapia')`,
      ),
    ).toBe(0);
    expect(
      writeCountAs(
        GOV_MANAGER,
        `insert into public.clinica_tipos_atendimento (organization_id, event_type_id, modalidade, valor_cents) values ('${GOV_ORG}', '${TIPO_A}', 'fisioterapia', 15000)`,
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

  it("uma clínica não vê a etiqueta da outra", () => {
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_tipos_atendimento;`)).toBe(1);
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
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_multas;`)).toBe(0);
    expect(countAs(GOV_ADMIN, `select count(*) from public.clinica_agenda_historico;`)).toBe(0);
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
