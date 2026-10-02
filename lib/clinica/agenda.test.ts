import { describe, expect, it } from "vitest";

import {
  acaoDoHistorico,
  cancelamentoSemMultaAte,
  faltaLiberadaEm,
  multaDoCancelamento,
  POLITICA_PADRAO,
  politicaDaLinha,
  REGRAS_PADRAO,
  regrasDaLinha,
  sessaoDaGrade,
  type LinhaDoCompromisso,
} from "./agenda";
import {
  gradeQuerySchema,
  politicaSchema,
  tipoAtendimentoSchema,
} from "./agenda-schemas";

const INICIO = new Date("2026-10-05T13:00:00Z"); // 10h em Brasília
const horasAntes = (h: number) => new Date(INICIO.getTime() - h * 60 * 60 * 1000);

describe("multa do cancelamento em cima da hora (regra da TOQ: <24h = 30%)", () => {
  const base = {
    inicio: INICIO,
    politica: POLITICA_PADRAO,
    valorDaSessaoCents: 15000,
    quemCancelou: "paciente" as const,
  };

  it("cancelou com 24h ou mais: sem multa", () => {
    expect(multaDoCancelamento({ ...base, canceladoEm: horasAntes(24) })).toBeNull();
    expect(multaDoCancelamento({ ...base, canceladoEm: horasAntes(48) })).toBeNull();
  });

  it("cancelou com menos de 24h: 30% do valor da sessão", () => {
    expect(multaDoCancelamento({ ...base, canceladoEm: horasAntes(3.5) })).toEqual({
      percentual: 30,
      antecedencia_horas: 3.5,
      valor_cents: 4500,
    });
  });

  it("cancelou depois do início: também é em cima da hora", () => {
    const m = multaDoCancelamento({ ...base, canceladoEm: horasAntes(-0.5) });
    expect(m?.antecedencia_horas).toBe(-0.5);
    expect(m?.valor_cents).toBe(4500);
  });

  it("a clínica cancelou: nunca há multa", () => {
    expect(
      multaDoCancelamento({ ...base, canceladoEm: horasAntes(1), quemCancelou: "clinica" }),
    ).toBeNull();
  });

  it("percentual configurável, e 0% desliga", () => {
    const politica = { ...POLITICA_PADRAO, multa_cancelamento_pct: 50 };
    expect(
      multaDoCancelamento({ ...base, politica, canceladoEm: horasAntes(2) })?.valor_cents,
    ).toBe(7500);
    expect(
      multaDoCancelamento({
        ...base,
        politica: { ...POLITICA_PADRAO, multa_cancelamento_pct: 0 },
        canceladoEm: horasAntes(2),
      }),
    ).toBeNull();
  });

  it("antecedência configurável", () => {
    const politica = { ...POLITICA_PADRAO, antecedencia_cancelamento_horas: 12 };
    expect(multaDoCancelamento({ ...base, politica, canceladoEm: horasAntes(13) })).toBeNull();
    expect(multaDoCancelamento({ ...base, politica, canceladoEm: horasAntes(11) })).not.toBeNull();
  });

  it("tipo sem valor de sessão: a multa nasce sem valor", () => {
    expect(
      multaDoCancelamento({ ...base, valorDaSessaoCents: null, canceladoEm: horasAntes(2) })
        ?.valor_cents,
    ).toBeNull();
  });
});

describe("tolerância de atraso e prazo sem multa", () => {
  it("falta só pode ser registrada 15 minutos depois do início", () => {
    expect(faltaLiberadaEm(INICIO, POLITICA_PADRAO).toISOString()).toBe("2026-10-05T13:15:00.000Z");
  });

  it("cancela sem multa até 24h antes", () => {
    expect(cancelamentoSemMultaAte(INICIO, POLITICA_PADRAO).toISOString()).toBe(
      "2026-10-04T13:00:00.000Z",
    );
  });

  it("regras sem linha gravada = os padrões da TOQ, e a linha só troca o que tem", () => {
    expect(regrasDaLinha(null)).toEqual(REGRAS_PADRAO);
    expect(REGRAS_PADRAO.pacote_sessoes_padrao).toBe(10);
    expect(REGRAS_PADRAO.pacote_validade_dias).toBe(60);
    const r = regrasDaLinha({ pacote_validade_dias: 90 });
    expect(r.pacote_validade_dias).toBe(90);
    expect(r.multa_cancelamento_pct).toBe(30);
  });

  it("política sem linha gravada = a padrão", () => {
    expect(politicaDaLinha(null)).toEqual(POLITICA_PADRAO);
    expect(politicaDaLinha({ tolerancia_atraso_minutos: 10 }).tolerancia_atraso_minutos).toBe(10);
  });
});

describe("histórico: transição da agenda → ação", () => {
  it("mapeia as transições que importam e ignora o resto", () => {
    expect(acaoDoHistorico("rescheduled")).toBe("remarcado");
    expect(acaoDoHistorico("cancelled")).toBe("cancelado");
    expect(acaoDoHistorico("no_show")).toBe("falta");
    expect(acaoDoHistorico("completed")).toBe("realizado");
    expect(acaoDoHistorico("confirmed")).toBe("confirmado");
    expect(acaoDoHistorico("pending")).toBeNull();
  });
});

describe("sessão da grade", () => {
  const linha: LinhaDoCompromisso = {
    id: "a1",
    title: "Sessão",
    starts_at: INICIO.toISOString(),
    ends_at: new Date(INICIO.getTime() + 50 * 60_000).toISOString(),
    status: "pending",
    owner_user_id: "u1",
    event_type_id: "t1",
    contact_id: "c1",
    contacts: { name: "Maria", display_name: null, phone_number: "5511999990000" },
  };

  it("sessão da clínica traz modalidade, tipo e prazos", () => {
    const tipos = new Map([["t1", { nome: "Fisio", modalidade: "fisioterapia" as const }]]);
    const s = sessaoDaGrade(linha, tipos, POLITICA_PADRAO);
    expect(s.modalidade).toBe("fisioterapia");
    expect(s.tipo).toEqual({ id: "t1", nome: "Fisio" });
    expect(s.paciente).toEqual({ id: "c1", nome: "Maria", telefone: "5511999990000" });
    expect(s.falta_liberada_em).toBe("2026-10-05T13:15:00.000Z");
    expect(s.cancelamento_sem_multa_ate).toBe("2026-10-04T13:00:00.000Z");
  });

  it("tipo sem modalidade: sem prazos de clínica", () => {
    const tipos = new Map([["t1", { nome: "Reunião", modalidade: null }]]);
    const s = sessaoDaGrade(linha, tipos, POLITICA_PADRAO);
    expect(s.modalidade).toBeNull();
    expect(s.falta_liberada_em).toBeNull();
    expect(s.cancelamento_sem_multa_ate).toBeNull();
  });
});

describe("validação das rotas", () => {
  it("grade: até 31 dias, filtros por vírgula", () => {
    const ok = gradeQuerySchema.safeParse({
      de: "2026-10-05T00:00:00-03:00",
      ate: "2026-10-12T00:00:00-03:00",
      modalidade: "fisioterapia,pilates",
    });
    expect(ok.success).toBe(true);
    expect(ok.data?.modalidade).toEqual(["fisioterapia", "pilates"]);
    expect(ok.data?.profissional).toEqual([]);
    expect(
      gradeQuerySchema.safeParse({ de: "2026-10-01T00:00:00Z", ate: "2026-11-15T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(
      gradeQuerySchema.safeParse({
        de: "2026-10-01T00:00:00Z",
        ate: "2026-10-02T00:00:00Z",
        modalidade: "nutricao",
      }).success,
    ).toBe(false);
  });

  it("política: faixas e nada vazio", () => {
    expect(politicaSchema.safeParse({ multa_cancelamento_pct: 30 }).success).toBe(true);
    expect(politicaSchema.safeParse({ multa_cancelamento_pct: 101 }).success).toBe(false);
    expect(politicaSchema.safeParse({}).success).toBe(false);
  });

  it("regras: parâmetros novos nas faixas do banco, e campo desconhecido é recusado", () => {
    expect(politicaSchema.safeParse({ pacote_validade_dias: 60 }).success).toBe(true);
    expect(politicaSchema.safeParse({ pacote_validade_dias: 0 }).success).toBe(false);
    expect(politicaSchema.safeParse({ faltas_no_mes_abandono: 3 }).success).toBe(true);
    expect(politicaSchema.safeParse({ organization_id: "x", multa_cancelamento_pct: 30 }).success).toBe(
      false,
    );
  });

  it("tipo de atendimento: modalidade nula tira a etiqueta", () => {
    expect(
      tipoAtendimentoSchema.safeParse({
        event_type_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        modalidade: null,
      }).success,
    ).toBe(true);
  });
});
