import { describe, expect, it } from "vitest";

import { MOTIVO_PADRAO_DA_ISENCAO, decideMulta, motivoDaIsencao } from "./multas";

describe("decideMulta", () => {
  it("administrador, gerente e recepção decidem", () => {
    expect(decideMulta("admin", [])).toBe(true);
    expect(decideMulta("manager", ["gerente"])).toBe(true);
    expect(decideMulta("agent", ["recepcao"])).toBe(true);
  });

  it("perfis de saúde, financeiro e jurídico só leem", () => {
    expect(decideMulta("agent", ["fisioterapeuta"])).toBe(false);
    expect(decideMulta("agent", ["medico", "enfermeiro"])).toBe(false);
    expect(decideMulta("manager", ["financeiro"])).toBe(false);
    expect(decideMulta("manager", ["juridico"])).toBe(false);
  });

  it("os perfis somam: fisioterapeuta que também é gerente decide", () => {
    expect(decideMulta("manager", ["gerente", "fisioterapeuta"])).toBe(true);
  });

  it("somente leitura nunca decide", () => {
    expect(decideMulta("viewer", ["recepcao"])).toBe(false);
  });
});

describe("motivoDaIsencao", () => {
  it("guarda o motivo escrito, sem espaços nas pontas", () => {
    expect(motivoDaIsencao("  trouxe atestado ")).toBe("trouxe atestado");
  });

  it("sem motivo, grava o padrão (o banco exige um)", () => {
    expect(motivoDaIsencao(undefined)).toBe(MOTIVO_PADRAO_DA_ISENCAO);
    expect(motivoDaIsencao("   ")).toBe(MOTIVO_PADRAO_DA_ISENCAO);
  });
});
