import { beforeAll, describe, expect, it } from "vitest";

import {
  countAs,
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/**
 * A ORIGEM DO PACIENTE NO BANCO (migration 9005, fork TOQ).
 *
 * O que só o banco garante: a lista de origens só o administrador muda; a origem de um paciente
 * ninguém grava pela API do Supabase (só o servidor, depois de conferir papel e organização);
 * uma clínica não vê a origem da outra; ninguém indica a si mesmo; e o relatório conta cada
 * contato novo uma vez, na origem certa, com "WhatsApp" calculado de `contacts.source` quando a
 * recepção não registrou nada.
 */
const ORG_B = "cccccccc-9005-4000-8000-0000000000b0";
const CONTATO_B = "cccccccc-9005-4000-8000-0000000000b1";
const ORIGEM_B = "cccccccc-9005-4000-8000-0000000000b2";
const O_WHATS = "cccccccc-9005-4000-8000-0000000000a1";
const O_INSTA = "cccccccc-9005-4000-8000-0000000000a2";
const O_INDICACAO = "cccccccc-9005-4000-8000-0000000000a3";
const ANTIGO = "cccccccc-9005-4000-8000-0000000000c0";
const c = (n: number) => `cccccccc-9005-4000-8000-0000000001${String(n).padStart(2, "0")}`;

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
      ('${ORG_B}', 'clinica-origens-b', 'Clinica Origens B', 'Clin Origens B')
      on conflict (id) do nothing;
    insert into public.contacts (id, organization_id, display_name, source) values
      ('${CONTATO_B}', '${ORG_B}', 'Paciente B', 'whatsapp')
      on conflict (id) do nothing;
    insert into public.clinica_origens (id, organization_id, nome, tipo) values
      ('${ORIGEM_B}', '${ORG_B}', 'WhatsApp', 'whatsapp')
      on conflict (id) do nothing;

    insert into public.clinica_origens (id, organization_id, nome, tipo, ordem) values
      ('${O_WHATS}', '${GOV_ORG}', 'WhatsApp', 'whatsapp', 10),
      ('${O_INSTA}', '${GOV_ORG}', 'Instagram', 'instagram', 20),
      ('${O_INDICACAO}', '${GOV_ORG}', 'Indicação', 'indicacao', 30)
      on conflict (id) do nothing;

    -- Cinco contatos novos (hoje) e um antigo, fora do período.
    insert into public.contacts (id, organization_id, display_name, source, created_at) values
      ('${c(1)}', '${GOV_ORG}', 'Chegou pelo WhatsApp', 'whatsapp', now()),
      ('${c(2)}', '${GOV_ORG}', 'Veio do Instagram, chamou no WhatsApp', 'whatsapp', now()),
      ('${c(3)}', '${GOV_ORG}', 'Também do anúncio', 'manual', now()),
      ('${c(4)}', '${GOV_ORG}', 'Indicada', 'manual', now()),
      ('${c(5)}', '${GOV_ORG}', 'Sem origem', 'manual', now()),
      ('${ANTIGO}', '${GOV_ORG}', 'Antigo, quem indicou', 'manual', now() - interval '400 days')
      on conflict (id) do nothing;

    -- O que a recepção registrou (pelo servidor).
    insert into public.clinica_pacientes_origem
      (organization_id, contact_id, origem_id, detalhe, indicado_por_contact_id) values
      ('${GOV_ORG}', '${c(2)}', '${O_INSTA}', 'Anúncio pago', null),
      ('${GOV_ORG}', '${c(3)}', '${O_INSTA}', 'Anúncio pago', null),
      ('${GOV_ORG}', '${c(4)}', '${O_INDICACAO}', null, '${ANTIGO}')
      on conflict (organization_id, contact_id) do nothing;

    -- Um pacote vendido a quem veio do anúncio, e um cancelado (não conta).
    insert into public.clinica_pacotes
      (organization_id, contact_id, nome, modalidade, sessoes_total, valor_cents, valido_ate,
       aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas)
    values
      ('${GOV_ORG}', '${c(2)}', 'Fisio 10', 'fisioterapia', 10, 120000, now() + interval '60 days', now(), 30, 24),
      ('${GOV_ORG}', '${c(3)}', 'Fisio 10', 'fisioterapia', 10, 120000, now() + interval '60 days', now(), 30, 24);
    update public.clinica_pacotes set status = 'cancelado', cancelado_em = now(), cancelamento_motivo = 'desistiu'
     where contact_id = '${c(3)}';
  `);
});

describe("origens: quem vê e quem escreve", () => {
  it("só o administrador muda a lista de origens", () => {
    const nova = (nome: string) =>
      `insert into public.clinica_origens (organization_id, nome, tipo) values ('${GOV_ORG}', '${nome}', 'outro')`;
    expect(writeCountAs(GOV_AGENT_A, nova("Panfleto recepção"))).toBe(0);
    expect(writeCountAs(GOV_MANAGER, nova("Panfleto gerente"))).toBe(0);
    expect(writeCountAs(GOV_ADMIN, nova("Panfleto"))).toBe(1);
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.clinica_origens set ativo = false where id = '${O_INSTA}'`,
      ),
    ).toBe(0);
  });

  it("ninguém grava a origem do paciente pela sessão, nem o administrador", () => {
    for (const quem of [GOV_AGENT_A, GOV_ADMIN]) {
      expect(
        writeCountAs(
          quem,
          `insert into public.clinica_pacientes_origem (organization_id, contact_id, origem_id) values ('${GOV_ORG}', '${c(5)}', '${O_WHATS}')`,
        ),
      ).toBe(0);
      expect(
        writeCountAs(quem, `update public.clinica_pacientes_origem set origem_id = '${O_WHATS}'`),
      ).toBe(0);
    }
  });

  it("todo membro lê a origem da própria clínica, e só dela", () => {
    expect(countAs(GOV_VIEWER, `select count(*) from public.clinica_pacientes_origem;`)).toBe(3);
    expect(
      countAs(GOV_ADMIN, `select count(*) from public.clinica_origens where id = '${ORIGEM_B}';`),
    ).toBe(0);
  });

  it("ninguém indica a si mesmo, e cada paciente tem uma origem só", () => {
    expect(
      erroComoDono(
        `update public.clinica_pacientes_origem set indicado_por_contact_id = contact_id where contact_id = '${c(4)}'`,
      ),
    ).toMatch(/check constraint/);
    expect(
      erroComoDono(
        `insert into public.clinica_pacientes_origem (organization_id, contact_id, origem_id) values ('${GOV_ORG}', '${c(2)}', '${O_WHATS}')`,
      ),
    ).toMatch(/duplicate key/);
  });

  it("origem em uso não é apagada", () => {
    expect(erroComoDono(`delete from public.clinica_origens where id = '${O_INSTA}'`)).toMatch(
      /foreign key/,
    );
  });

  it("o relatório não é alcançável pela sessão nem pela anon key", () => {
    const fn = "public.fn_clinica_relatorio_origens(uuid, timestamptz, timestamptz)";
    expect(
      sql(
        `select has_function_privilege('anon', '${fn}', 'execute') || '/' || has_function_privilege('authenticated', '${fn}', 'execute') || '/' || has_function_privilege('service_role', '${fn}', 'execute');`,
      ).trim(),
    ).toBe("false/false/true");
  });
});

describe("origens: o relatório", () => {
  const linhas = () =>
    sql(
      `select coalesce(o.nome, 'sem origem') || '|' || coalesce(r.detalhe, '-') || '|' || r.automatica || '|' || r.novos || '|' || r.com_pacote || '|' || r.pacotes_valor_cents
         from public.fn_clinica_relatorio_origens('${GOV_ORG}', now() - interval '1 day', now() + interval '1 day') r
         left join public.clinica_origens o on o.id = r.origem_id
        order by 1;`,
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("|"));

  it("WhatsApp sem registro vira origem automática; o registro da recepção vence", () => {
    const r = linhas();
    expect(r).toContain("WhatsApp|-|true|1|0|0");
    expect(r).toContain("Instagram|Anúncio pago|false|2|1|120000");
    expect(r).toContain("Indicação|-|false|1|0|0");
  });

  it("contato sem origem aparece como tal, e o antigo fica fora do período", () => {
    const r = linhas();
    const semOrigem = r.find((l) => l.startsWith("sem origem"));
    // c(5) mais os contatos do elenco comum criados agora (seedGov), todos sem origem.
    expect(semOrigem).toMatch(/^sem origem\|-\|false\|\d+\|0\|0$/);
    const total = r.reduce((soma, l) => soma + Number(l.split("|")[3]), 0);
    expect(
      Number(
        sql(
          `select count(*) from public.contacts where organization_id = '${GOV_ORG}' and kind = 'person' and is_merged_into is null and created_at >= now() - interval '1 day';`,
        ).trim(),
      ),
    ).toBe(total);
  });

  it("uma clínica não entra no relatório da outra", () => {
    expect(
      sql(
        `select count(*) from public.fn_clinica_relatorio_origens('${GOV_ORG}', now() - interval '1 day', now() + interval '1 day') where origem_id = '${ORIGEM_B}';`,
      ).trim(),
    ).toBe("0");
  });
});
