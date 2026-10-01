import { describe, expect, it } from "vitest";

import { ehReavaliacao, resumoDoPaciente, type SessaoDoPaciente } from "./resumo-do-paciente";

const AGORA = new Date("2026-10-01T15:00:00.000Z");

function sessao(
  id: string,
  inicio: string,
  extra: Partial<SessaoDoPaciente> = {},
): SessaoDoPaciente {
  return {
    id,
    titulo: "Sessão de fisioterapia",
    tipo: "Sessão de fisioterapia",
    inicio,
    situacao: "confirmed",
    donoId: "rafael",
    ...extra,
  };
}

describe("resumoDoPaciente", () => {
  it("acha a próxima sessão e a reavaliação, sem contar cancelada nem falta", () => {
    const resumo = resumoDoPaciente(
      [
        sessao("cancelada", "2026-10-02T12:00:00.000Z", { situacao: "cancelled" }),
        sessao("reav", "2026-10-30T17:00:00.000Z", {
          tipo: "Reavaliação",
          titulo: "Reavaliação",
          donoId: "helena",
        }),
        sessao("proxima", "2026-10-03T12:00:00.000Z", { situacao: "pending" }),
      ],
      AGORA,
    );
    expect(resumo.proxima?.id).toBe("proxima");
    expect(resumo.reavaliacao?.id).toBe("reav");
  });

  it("conta as sessões passadas e as faltas", () => {
    const resumo = resumoDoPaciente(
      [
        sessao("a", "2026-09-20T12:00:00.000Z", { situacao: "completed" }),
        sessao("b", "2026-09-24T12:00:00.000Z"),
        sessao("c", "2026-09-27T12:00:00.000Z", { situacao: "no_show" }),
        sessao("d", "2026-09-28T12:00:00.000Z", { situacao: "cancelled" }),
      ],
      AGORA,
    );
    expect(resumo.passadas).toEqual({ sessoes: 2, faltas: 1 });
    expect(resumo.proxima).toBeNull();
    expect(resumo.reavaliacao).toBeNull();
  });

  it("lista as modalidades na ordem do vocabulário e a equipe pela proximidade de agora", () => {
    const resumo = resumoDoPaciente(
      [
        sessao("antiga", "2026-08-10T12:00:00.000Z", {
          tipo: "Atendimento de enfermagem",
          donoId: "marcos",
        }),
        sessao("pilates", "2026-10-02T12:00:00.000Z", { tipo: "Aula de pilates", donoId: "julia" }),
        sessao("fisio", "2026-09-29T12:00:00.000Z"),
        sessao("reuniao", "2026-09-30T12:00:00.000Z", {
          tipo: null,
          titulo: "Reunião de família",
          donoId: null,
        }),
      ],
      AGORA,
    );
    expect(resumo.modalidades).toEqual(["fisioterapia", "pilates", "enfermagem"]);
    expect(resumo.equipe).toEqual(["julia", "rafael", "marcos"]);
  });

  it("sem sessão nenhuma, tudo vazio", () => {
    expect(resumoDoPaciente([], AGORA)).toEqual({
      proxima: null,
      reavaliacao: null,
      passadas: { sessoes: 0, faltas: 0 },
      modalidades: [],
      equipe: [],
    });
  });
});

describe("ehReavaliacao", () => {
  it.each([
    [{ tipo: "Reavaliação", titulo: "x" }, true],
    [{ tipo: null, titulo: "reavaliacao de fisio" }, true],
    [{ tipo: "Avaliação de fisioterapia", titulo: "x" }, false],
  ])("%o → %s", (s, esperado) => {
    expect(ehReavaliacao(s)).toBe(esperado);
  });
});
