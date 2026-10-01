import { describe, expect, it } from "vitest";

import { corDaModalidade, modalidadeDoTipo } from "./cores-da-agenda";

describe("modalidadeDoTipo", () => {
  it.each([
    ["Sessão de fisioterapia", "fisioterapia"],
    ["Avaliação de Fisioterapia", "fisioterapia"],
    ["Aula de pilates", "pilates"],
    ["Pilates com fisioterapeuta", "pilates"],
    ["Consulta médica", "medicina"],
    ["Consulta Medica", "medicina"],
    ["Atendimento de enfermagem", "enfermagem"],
  ] as const)("%s → %s", (nome, esperada) => {
    expect(modalidadeDoTipo(nome)).toBe(esperada);
  });

  it.each(["Reunião", "Consulta", "Reavaliação", "Ocupado", "", null, undefined])(
    "%s não vira modalidade nenhuma",
    (nome) => {
      expect(modalidadeDoTipo(nome)).toBeNull();
    },
  );
});

describe("corDaModalidade", () => {
  it("aponta para a variável do tema, nunca para um hex", () => {
    expect(corDaModalidade("pilates")).toBe("var(--agenda-modalidade-pilates)");
    expect(corDaModalidade(null)).toBe("var(--agenda-modalidade-outra)");
  });
});
