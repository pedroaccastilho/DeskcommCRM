import { describe, expect, it } from "vitest";

import { podeMarcarASessao } from "./presenca";

const EU = "11111111-1111-4111-8111-111111111111";
const COLEGA = "22222222-2222-4222-8222-222222222222";

describe("quem marca presença, chegada e falta de uma sessão da clínica", () => {
  it("a fisioterapeuta marca a própria sessão", () => {
    expect(
      podeMarcarASessao({ role: "agent", cargos: ["fisioterapeuta"], userId: EU, donoId: EU }),
    ).toBe(true);
  });

  it("a fisioterapeuta não marca a sessão do médico, e o médico não marca a dela", () => {
    expect(
      podeMarcarASessao({ role: "agent", cargos: ["fisioterapeuta"], userId: EU, donoId: COLEGA }),
    ).toBe(false);
    expect(
      podeMarcarASessao({ role: "agent", cargos: ["medico"], userId: COLEGA, donoId: EU }),
    ).toBe(false);
  });

  it("recepção, gerente e administrador marcam a de todos", () => {
    for (const [role, cargos] of [
      ["agent", ["recepcao"]],
      ["manager", ["gerente"]],
      ["admin", ["administrador"]],
      ["admin", []],
    ] as const) {
      expect(podeMarcarASessao({ role, cargos, userId: EU, donoId: COLEGA })).toBe(true);
    }
  });

  it("os perfis somam: fisioterapeuta que também é gerente marca todas", () => {
    expect(
      podeMarcarASessao({
        role: "manager",
        cargos: ["gerente", "fisioterapeuta"],
        userId: EU,
        donoId: COLEGA,
      }),
    ).toBe(true);
  });

  it("Financeiro e Jurídico, mesmo com papel de gerente no núcleo, não marcam a sessão alheia", () => {
    expect(
      podeMarcarASessao({ role: "manager", cargos: ["financeiro"], userId: EU, donoId: COLEGA }),
    ).toBe(false);
    expect(
      podeMarcarASessao({ role: "manager", cargos: ["juridico"], userId: EU, donoId: COLEGA }),
    ).toBe(false);
  });

  it("sessão sem profissional: só quem marca de todos", () => {
    expect(
      podeMarcarASessao({ role: "agent", cargos: ["medico"], userId: EU, donoId: null }),
    ).toBe(false);
    expect(
      podeMarcarASessao({ role: "agent", cargos: ["recepcao"], userId: EU, donoId: null }),
    ).toBe(true);
  });
});
