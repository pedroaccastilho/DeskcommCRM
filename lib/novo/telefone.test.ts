import { describe, expect, it } from "vitest";

import { telefoneParaE164 } from "./telefone";

describe("telefoneParaE164", () => {
  it("aceita o jeito que a recepção digita um celular", () => {
    expect(telefoneParaE164("(11) 98888-7777")).toBe("+5511988887777");
    expect(telefoneParaE164("11 98888 7777")).toBe("+5511988887777");
    expect(telefoneParaE164("11988887777")).toBe("+5511988887777");
  });

  it("aceita fixo com DDD e número que já vem com o 55", () => {
    expect(telefoneParaE164("(31) 3333-4444")).toBe("+553133334444");
    expect(telefoneParaE164("55 11 98888-7777")).toBe("+5511988887777");
  });

  it("respeita o DDI de fora quando vem com +", () => {
    expect(telefoneParaE164("+1 415 555 0100")).toBe("+14155550100");
    expect(telefoneParaE164("+55 (11) 98888-7777")).toBe("+5511988887777");
  });

  it("devolve null para o que não é telefone", () => {
    expect(telefoneParaE164("")).toBeNull();
    expect(telefoneParaE164("98888-7777")).toBeNull();
    expect(telefoneParaE164("abc")).toBeNull();
  });
});
