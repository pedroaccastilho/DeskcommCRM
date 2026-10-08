import { describe, expect, it } from "vitest";

import { andar, diaDaSemana, diasDaVisao, faixasLadoALado } from "./agenda";

describe("visões da agenda nova", () => {
  it("a semana vai de segunda a domingo", () => {
    // 8 de outubro de 2026 é quinta-feira.
    expect(diaDaSemana("2026-10-08")).toBe(3);
    expect(diasDaVisao("semana", "2026-10-08")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(diasDaVisao("semana", "2026-10-11")[0]).toBe("2026-10-05");
  });

  it("o mês cobre do dia 1 ao último, dentro do limite da grade", () => {
    const outubro = diasDaVisao("mes", "2026-10-08");
    expect(outubro).toHaveLength(31);
    expect(outubro[0]).toBe("2026-10-01");
    expect(outubro.at(-1)).toBe("2026-10-31");
    expect(diasDaVisao("mes", "2028-02-10")).toHaveLength(29);
  });

  it("as setas andam um dia, uma semana ou um mês sem pular mês curto", () => {
    expect(andar("dia", "2026-12-31", 1)).toBe("2027-01-01");
    expect(andar("semana", "2026-10-08", -1)).toBe("2026-10-01");
    expect(andar("mes", "2027-01-31", 1)).toBe("2027-02-01");
    expect(andar("mes", "2027-01-15", -1)).toBe("2026-12-01");
  });

  it("sessões sobrepostas dividem a largura; as soltas ficam inteiras", () => {
    const faixas = faixasLadoALado([
      { id: "a", inicio: 8, fim: 9 },
      { id: "b", inicio: 8.5, fim: 9.5 },
      { id: "c", inicio: 9, fim: 10 },
      { id: "d", inicio: 11, fim: 12 },
    ]);
    expect(faixas.get("a")).toEqual({ faixa: 0, faixas: 2 });
    expect(faixas.get("b")).toEqual({ faixa: 1, faixas: 2 });
    // "c" começa quando "a" acaba: reaproveita a primeira faixa.
    expect(faixas.get("c")).toEqual({ faixa: 0, faixas: 2 });
    expect(faixas.get("d")).toEqual({ faixa: 0, faixas: 1 });
  });
});
