import { describe, expect, it } from "vitest";

import { espalharPorDia, estadoDoMetadata } from "./executor";

describe("espalharPorDia", () => {
  it("alterna entre os dias em vez de pegar só o primeiro dia", () => {
    const itens = [
      { dia: "Ter 06/10", h: "08:00" },
      { dia: "Ter 06/10", h: "09:00" },
      { dia: "Ter 06/10", h: "10:00" },
      { dia: "Qua 07/10", h: "08:00" },
      { dia: "Qui 08/10", h: "08:00" },
    ];
    expect(espalharPorDia(itens, 4).map((i) => `${i.dia} ${i.h}`)).toEqual([
      "Ter 06/10 08:00",
      "Qua 07/10 08:00",
      "Qui 08/10 08:00",
      "Ter 06/10 09:00",
    ]);
  });

  it("menos itens que o teto devolve todos", () => {
    expect(espalharPorDia([{ dia: "a" }], 6)).toHaveLength(1);
    expect(espalharPorDia([], 6)).toEqual([]);
  });
});

describe("estadoDoMetadata", () => {
  it("lê o estado que o motor gravou", () => {
    const estado = { etapa: "menu", erros: 1, atualizado_em: "2026-10-05T12:00:00.000Z" };
    expect(estadoDoMetadata({ outro: 1, chatbot_menu: estado })).toEqual(estado);
  });

  it("forma estranha recomeça do menu (null)", () => {
    expect(estadoDoMetadata(null)).toBeNull();
    expect(estadoDoMetadata({})).toBeNull();
    expect(estadoDoMetadata({ chatbot_menu: "menu" })).toBeNull();
    expect(estadoDoMetadata({ chatbot_menu: { etapa: "menu" } })).toBeNull();
  });
});
