import { describe, expect, it } from "vitest";

import { avisoDoCancelamento, faltaTravadaAte } from "./sessao-no-detalhe";

const politica = { multa_cancelamento_pct: 30 };
const limite = "2026-10-05T12:00:00.000Z";
const antes = Date.parse("2026-10-05T11:59:00.000Z");
const depois = Date.parse("2026-10-05T12:00:00.000Z");

describe("avisoDoCancelamento", () => {
  it("avisa até quando dá para cancelar sem multa", () => {
    expect(avisoDoCancelamento({ cancelamento_sem_multa_ate: limite }, politica, antes)).toEqual({
      tipo: "sem_multa",
      ate: new Date(limite),
    });
  });

  it("no limite em diante, cancelar gera a multa da política", () => {
    expect(avisoDoCancelamento({ cancelamento_sem_multa_ate: limite }, politica, depois)).toEqual({
      tipo: "com_multa",
      percentual: 30,
    });
  });

  it("não avisa nada fora de sessão da clínica nem com multa zerada", () => {
    expect(avisoDoCancelamento(null, politica, depois)).toBeNull();
    expect(avisoDoCancelamento({ cancelamento_sem_multa_ate: null }, politica, depois)).toBeNull();
    expect(
      avisoDoCancelamento(
        { cancelamento_sem_multa_ate: limite },
        { multa_cancelamento_pct: 0 },
        depois,
      ),
    ).toBeNull();
  });
});

describe("faltaTravadaAte", () => {
  it("trava a falta até o fim da tolerância", () => {
    expect(faltaTravadaAte({ falta_liberada_em: limite }, antes)).toEqual(new Date(limite));
  });

  it("libera a falta a partir do fim da tolerância", () => {
    expect(faltaTravadaAte({ falta_liberada_em: limite }, depois)).toBeNull();
  });

  it("não trava compromisso que não é sessão da clínica", () => {
    expect(faltaTravadaAte(null, antes)).toBeNull();
    expect(faltaTravadaAte({ falta_liberada_em: null }, antes)).toBeNull();
  });
});
