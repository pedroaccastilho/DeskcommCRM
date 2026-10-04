import { describe, expect, it } from "vitest";

import type { SessaoDaGrade } from "@/lib/clinica/agenda";

import { arrumarDia, janelaDoDia, momentoDa, quantoFalta, saudacao, soAsMinhas } from "./hoje";

function sessao(p: Partial<SessaoDaGrade> & { inicio: string; fim: string }): SessaoDaGrade {
  return {
    id: p.id ?? p.inicio,
    titulo: "Sessão",
    status: "confirmed",
    profissional_user_id: null,
    modalidade: "fisioterapia",
    tipo: null,
    paciente: null,
    falta_liberada_em: null,
    cancelamento_sem_multa_ate: null,
    chegou_em: null,
    atendimento_iniciado_em: null,
    ...p,
  };
}

const AGORA = new Date("2026-10-03T13:30:00Z");

describe("momento de cada sessão no dia", () => {
  it("separa agora, para fechar, sem confirmação, confirmada e encerrada", () => {
    expect(
      momentoDa(sessao({ inicio: "2026-10-03T13:00:00Z", fim: "2026-10-03T14:00:00Z" }), AGORA),
    ).toBe("agora");
    expect(
      momentoDa(sessao({ inicio: "2026-10-03T12:00:00Z", fim: "2026-10-03T13:00:00Z" }), AGORA),
    ).toBe("para_fechar");
    expect(
      momentoDa(
        sessao({ inicio: "2026-10-03T15:00:00Z", fim: "2026-10-03T16:00:00Z", status: "pending" }),
        AGORA,
      ),
    ).toBe("sem_confirmacao");
    expect(
      momentoDa(sessao({ inicio: "2026-10-03T15:00:00Z", fim: "2026-10-03T16:00:00Z" }), AGORA),
    ).toBe("confirmada");
    expect(
      momentoDa(
        sessao({
          inicio: "2026-10-03T12:00:00Z",
          fim: "2026-10-03T13:00:00Z",
          status: "completed",
        }),
        AGORA,
      ),
    ).toBe("encerrada");
  });

  it("a próxima é a primeira que ainda não começou, e cancelada não conta no total", () => {
    const dia = arrumarDia(
      [
        sessao({ id: "c", inicio: "2026-10-03T17:00:00Z", fim: "2026-10-03T18:00:00Z" }),
        sessao({
          id: "b",
          inicio: "2026-10-03T15:00:00Z",
          fim: "2026-10-03T16:00:00Z",
          status: "pending",
        }),
        sessao({
          id: "x",
          inicio: "2026-10-03T11:00:00Z",
          fim: "2026-10-03T12:00:00Z",
          status: "cancelled",
        }),
        sessao({
          id: "r",
          inicio: "2026-10-03T10:00:00Z",
          fim: "2026-10-03T11:00:00Z",
          status: "completed",
        }),
      ],
      AGORA,
    );
    expect(dia.proxima?.id).toBe("b");
    expect(dia.total).toBe(3);
    expect(dia.realizadas).toBe(1);
    expect(dia.encerradas.map((s) => s.id)).toEqual(["r", "x"]);
  });

  it("quem atende vê só as próprias sessões", () => {
    const lista = [
      sessao({
        id: "a",
        inicio: "2026-10-03T15:00:00Z",
        fim: "2026-10-03T16:00:00Z",
        profissional_user_id: "eu",
      }),
      sessao({
        id: "b",
        inicio: "2026-10-03T15:00:00Z",
        fim: "2026-10-03T16:00:00Z",
        profissional_user_id: "outra",
      }),
    ];
    expect(soAsMinhas(lista, "eu").map((s) => s.id)).toEqual(["a"]);
    expect(soAsMinhas(lista, null)).toHaveLength(2);
  });
});

describe("textos do dia", () => {
  it("saudação pela hora", () => {
    expect(saudacao(8)).toBe("Bom dia");
    expect(saudacao(14)).toBe("Boa tarde");
    expect(saudacao(20)).toBe("Boa noite");
  });

  it("quanto falta em português de gente", () => {
    expect(quantoFalta(new Date("2026-10-03T13:42:00Z"), AGORA)).toBe("em 12 min");
    expect(quantoFalta(new Date("2026-10-03T14:35:00Z"), AGORA)).toBe("em 1h 05");
    expect(quantoFalta(new Date("2026-10-03T15:30:00Z"), AGORA)).toBe("em 2h");
    expect(quantoFalta(new Date("2026-10-03T13:10:00Z"), AGORA)).toBe("há 20 min");
  });

  it("a linha do dia estica para caber as sessões", () => {
    expect(janelaDoDia([])).toEqual({ de: 7, ate: 20 });
    expect(
      janelaDoDia([
        { inicio: 6.5, fim: 7.5 },
        { inicio: 20, fim: 21.25 },
      ]),
    ).toEqual({ de: 6, ate: 22 });
  });
});
