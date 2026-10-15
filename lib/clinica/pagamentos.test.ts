import { describe, expect, it } from "vitest";

import { multaDaFalta, POLITICA_PADRAO } from "./agenda";
import {
  pagamentoDe,
  registraPagamento,
  registrarPagamentoSchema,
  sessaoAvulsa,
  type PagamentosDoPaciente,
} from "./pagamentos";

const ID = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

describe("registraPagamento: quem diz que o paciente pagou", () => {
  it("Administrador, Gerente, Recepção e Financeiro registram", () => {
    expect(registraPagamento("admin", [])).toBe(true);
    for (const cargo of ["gerente", "recepcao", "financeiro"]) {
      expect(registraPagamento("agent", [cargo])).toBe(true);
    }
  });

  it("os perfis de saúde e o Jurídico só leem; Somente leitura nunca", () => {
    for (const cargo of ["fisioterapeuta", "medico", "enfermeiro", "educador_fisico", "juridico"]) {
      expect(registraPagamento("agent", [cargo])).toBe(false);
    }
    expect(registraPagamento("viewer", ["recepcao"])).toBe(false);
  });

  it("os perfis somam: a fisioterapeuta que também é gerente registra", () => {
    expect(registraPagamento("manager", ["fisioterapeuta", "gerente"])).toBe(true);
  });
});

describe("registrarPagamentoSchema", () => {
  it("aceita exatamente uma coisa paga, com a forma", () => {
    expect(registrarPagamentoSchema.safeParse({ pacote_id: ID, forma: "pix" }).success).toBe(true);
    expect(
      registrarPagamentoSchema.safeParse({ multa_id: ID, forma: "dinheiro", valor_cents: 4500 })
        .success,
    ).toBe(true);
  });

  it("recusa nada pago, duas coisas pagas e forma fora da lista", () => {
    expect(registrarPagamentoSchema.safeParse({ forma: "pix" }).success).toBe(false);
    expect(
      registrarPagamentoSchema.safeParse({ pacote_id: ID, multa_id: OUTRO, forma: "pix" }).success,
    ).toBe(false);
    expect(registrarPagamentoSchema.safeParse({ pacote_id: ID, forma: "boleto" }).success).toBe(
      false,
    );
  });

  it("não deixa o corpo escolher o paciente nem a organização", () => {
    expect(
      registrarPagamentoSchema.safeParse({ pacote_id: ID, forma: "pix", contact_id: OUTRO })
        .success,
    ).toBe(false);
  });
});

const pago = (alvo: Partial<Record<"pacote_id" | "appointment_id" | "multa_id", string>>) => ({
  id: "p",
  contact_id: "c",
  pacote_id: alvo.pacote_id ?? null,
  appointment_id: alvo.appointment_id ?? null,
  multa_id: alvo.multa_id ?? null,
  forma: "pix" as const,
  valor_cents: 15000,
  currency: "BRL",
  pago_em: "2026-10-15T12:00:00Z",
});

describe("sessaoAvulsa: quando a sessão se paga à parte", () => {
  const vazio: PagamentosDoPaciente = { pagamentos: [], sessoes_em_pacote: [] };

  it("sem pacote valendo, a sessão é avulsa", () => {
    expect(
      sessaoAvulsa({
        appointmentId: ID,
        status: "completed",
        temPacoteValendo: false,
        dados: vazio,
      }),
    ).toBe(true);
  });

  it("a que gastou pacote, ou vai gastar um que está valendo, não é", () => {
    expect(
      sessaoAvulsa({
        appointmentId: ID,
        status: "completed",
        temPacoteValendo: false,
        dados: { pagamentos: [], sessoes_em_pacote: [ID] },
      }),
    ).toBe(false);
    expect(
      sessaoAvulsa({
        appointmentId: ID,
        status: "scheduled",
        temPacoteValendo: true,
        dados: vazio,
      }),
    ).toBe(false);
  });

  it("cancelada e falta não se pagam como sessão (o que se cobra é a multa)", () => {
    for (const status of ["cancelled", "no_show", "rescheduled"]) {
      expect(
        sessaoAvulsa({ appointmentId: ID, status, temPacoteValendo: false, dados: vazio }),
      ).toBe(false);
    }
  });

  it("a já paga segue mostrando o pagamento, mesmo com pacote vendido depois", () => {
    expect(
      sessaoAvulsa({
        appointmentId: ID,
        status: "completed",
        temPacoteValendo: true,
        dados: { pagamentos: [pago({ appointment_id: ID })], sessoes_em_pacote: [] },
      }),
    ).toBe(true);
  });
});

describe("pagamentoDe", () => {
  it("acha o pagamento pela coisa paga, e só por ela", () => {
    const dados = { pagamentos: [pago({ multa_id: ID })], sessoes_em_pacote: [] };
    expect(pagamentoDe(dados, { multa_id: ID })?.forma).toBe("pix");
    expect(pagamentoDe(dados, { pacote_id: ID })).toBeNull();
    expect(pagamentoDe(undefined, { multa_id: ID })).toBeNull();
  });
});

describe("multaDaFalta: o mesmo percentual da multa de cancelamento", () => {
  const inicio = new Date("2026-10-15T13:00:00Z");
  const registradaEm = new Date("2026-10-15T13:30:00Z");

  it("30% do valor da sessão, com a antecedência negativa (registrada depois do início)", () => {
    expect(
      multaDaFalta({ inicio, registradaEm, politica: POLITICA_PADRAO, valorDaSessaoCents: 15000 }),
    ).toEqual({ percentual: 30, antecedencia_horas: -0.5, valor_cents: 4500 });
  });

  it("sem valor de sessão, nasce só com o percentual; com 0% não há multa", () => {
    expect(
      multaDaFalta({ inicio, registradaEm, politica: POLITICA_PADRAO, valorDaSessaoCents: null })
        ?.valor_cents,
    ).toBeNull();
    expect(
      multaDaFalta({
        inicio,
        registradaEm,
        politica: { ...POLITICA_PADRAO, multa_cancelamento_pct: 0 },
        valorDaSessaoCents: 15000,
      }),
    ).toBeNull();
  });
});
