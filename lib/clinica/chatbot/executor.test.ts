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
    const menu = {
      tipo: "menu",
      noId: "menu",
      erros: 1,
      atualizado_em: "2026-10-05T12:00:00.000Z",
    };
    expect(estadoDoMetadata({ outro: 1, chatbot_fluxo: menu })).toEqual(menu);
    const pergunta = { tipo: "pergunta", noId: "q", atualizado_em: "2026-10-05T12:00:00.000Z" };
    expect(estadoDoMetadata({ chatbot_fluxo: pergunta })).toEqual(pergunta);
  });

  it("forma estranha recomeça do Início (null)", () => {
    expect(estadoDoMetadata(null)).toBeNull();
    expect(estadoDoMetadata({})).toBeNull();
    expect(estadoDoMetadata({ chatbot_fluxo: "menu" })).toBeNull();
    expect(estadoDoMetadata({ chatbot_fluxo: { tipo: "menu", noId: "menu" } })).toBeNull();
    expect(
      estadoDoMetadata({
        chatbot_fluxo: { tipo: "agenda", noId: "m", erros: 0, atualizado_em: "x" },
      }),
    ).toBeNull();
    // O estado do menu fixo antigo (sem `tipo`) não é lido.
    expect(
      estadoDoMetadata({
        chatbot_fluxo: { etapa: "menu", erros: 0, atualizado_em: "2026-10-05T12:00:00.000Z" },
      }),
    ).toBeNull();
  });
});
