import { describe, expect, it } from "vitest";

import { fusoLongeDaVirada } from "../e2e/helpers/virada-do-dia";

describe("specs da clínica longe da virada do dia", () => {
  it("de dia em São Paulo, o fuso não muda", () => {
    expect(fusoLongeDaVirada(30, 180, new Date("2026-10-05T15:00:00Z"))).toBe("America/Sao_Paulo");
  });

  it("perto da meia-noite de São Paulo, vale um fuso em que a janela inteira cabe no dia", () => {
    // 23h45 em Brasília: a sessão de daqui a 1 h cairia amanhã (a rodada que ficou vermelha).
    const tarde = new Date("2026-10-05T02:45:00Z");
    expect(fusoLongeDaVirada(30, 180, tarde)).toBe("Europe/Lisbon");
    // 00h10 em Brasília: a sessão de 25 min atrás cairia ontem.
    expect(fusoLongeDaVirada(30, 120, new Date("2026-10-05T03:10:00Z"))).toBe("Europe/Lisbon");
  });

  it("toda hora do dia tem um fuso que serve", () => {
    for (let h = 0; h < 24; h += 1) {
      const agora = new Date(Date.UTC(2026, 9, 5, h, 30));
      expect(() => fusoLongeDaVirada(30, 180, agora)).not.toThrow();
    }
  });
});
