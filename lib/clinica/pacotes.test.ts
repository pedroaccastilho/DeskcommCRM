import { describe, expect, it } from "vitest";

import {
  consumoDaTransicao,
  nomePadraoDoPacote,
  precisaRenovar,
  reembolsoSugerido,
  saldoDoPacote,
  situacaoDoPacote,
  validoAte,
  valorDaSessaoNoPacote,
} from "./pacotes";

const AGORA = new Date("2026-10-03T12:00:00Z");
const pacote = (over: Partial<Parameters<typeof situacaoDoPacote>[0]> = {}) => ({
  status: "ativo" as const,
  sessoes_total: 10,
  sessoes_usadas: 3,
  valido_ate: "2026-11-01T12:00:00Z",
  ...over,
});

describe("consumo pela mudança da agenda", () => {
  it("realizada e falta gastam; cancelar, remarcar e voltar para agendada devolvem", () => {
    expect(consumoDaTransicao("completed")).toBe("realizada");
    expect(consumoDaTransicao("no_show")).toBe("falta");
    for (const t of ["cancelled", "rescheduled", "scheduled", "confirmed"]) {
      expect(consumoDaTransicao(t)).toBeNull();
    }
    expect(consumoDaTransicao("qualquer")).toBeUndefined();
  });
});

describe("saldo e situação", () => {
  it("o saldo é o total menos as gastas, nunca negativo", () => {
    expect(saldoDoPacote(pacote())).toBe(7);
    expect(saldoDoPacote(pacote({ sessoes_usadas: 12 }))).toBe(0);
  });

  it("cancelado vence esgotado, que vence vencido", () => {
    expect(situacaoDoPacote(pacote(), AGORA)).toBe("ativo");
    expect(situacaoDoPacote(pacote({ valido_ate: "2026-10-01T00:00:00Z" }), AGORA)).toBe("vencido");
    expect(situacaoDoPacote(pacote({ sessoes_usadas: 10, valido_ate: "2026-10-01T00:00:00Z" }), AGORA)).toBe(
      "esgotado",
    );
    expect(situacaoDoPacote(pacote({ status: "cancelado", sessoes_usadas: 10 }), AGORA)).toBe("cancelado");
  });

  it("renovação: pacote ativo com o saldo no limite das Regras (2)", () => {
    expect(precisaRenovar(pacote({ sessoes_usadas: 8 }), 2, AGORA)).toBe(true);
    expect(precisaRenovar(pacote({ sessoes_usadas: 7 }), 2, AGORA)).toBe(false);
    expect(precisaRenovar(pacote({ sessoes_usadas: 10 }), 2, AGORA)).toBe(false);
    expect(precisaRenovar(pacote({ sessoes_usadas: 9, valido_ate: "2026-10-01T00:00:00Z" }), 2, AGORA)).toBe(false);
  });
});

describe("dinheiro", () => {
  it("a sessão no pacote vale o total dividido pelas sessões", () => {
    expect(valorDaSessaoNoPacote(150000, 10)).toBe(15000);
    expect(valorDaSessaoNoPacote(100000, 3)).toBe(33333);
    expect(valorDaSessaoNoPacote(null, 10)).toBeNull();
  });

  it("o reembolso é das restantes pelo preço avulso, sem passar do que foi pago", () => {
    expect(reembolsoSugerido({ restantes: 4, precoAvulsoCents: 18000, valorPagoCents: 150000 })).toBe(72000);
    expect(reembolsoSugerido({ restantes: 9, precoAvulsoCents: 18000, valorPagoCents: 150000 })).toBe(150000);
    expect(reembolsoSugerido({ restantes: 4, precoAvulsoCents: null, valorPagoCents: 150000 })).toBeNull();
    expect(reembolsoSugerido({ restantes: 4, precoAvulsoCents: 18000, valorPagoCents: null })).toBe(72000);
  });
});

describe("venda", () => {
  it("nome padrão e validade a partir da compra", () => {
    expect(nomePadraoDoPacote(10, "fisioterapia")).toBe("Fisioterapia — 10 sessões");
    expect(nomePadraoDoPacote(1, "pilates")).toBe("Pilates — 1 sessão");
    expect(validoAte(AGORA, 60).toISOString()).toBe("2026-12-02T12:00:00.000Z");
  });
});
