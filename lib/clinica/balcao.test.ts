import { describe, expect, it } from "vitest";

import { POLITICA_PADRAO, type SessaoDaGrade } from "./agenda";
import {
  acoesDoBalcao,
  contagemPorFiltro,
  faltaLiberada,
  filaDoDia,
  previaDaMulta,
  situacaoNoBalcao,
} from "./balcao";

// Quinta, 2 de outubro de 2026, 9h40 em São Paulo (12h40 UTC).
const AGORA = new Date("2026-10-02T12:40:00.000Z");

function sessao(parcial: Partial<SessaoDaGrade>): SessaoDaGrade {
  return {
    id: Math.random().toString(36).slice(2),
    titulo: "Sessão de fisioterapia",
    inicio: "2026-10-02T13:30:00.000Z",
    fim: "2026-10-02T14:20:00.000Z",
    status: "confirmed",
    profissional_user_id: "camila",
    modalidade: "fisioterapia",
    tipo: { id: "tipo-fisio", nome: "Sessão de fisioterapia" },
    paciente: { id: "ana", nome: "Ana Beatriz", telefone: "5511990000101" },
    falta_liberada_em: "2026-10-02T13:45:00.000Z",
    cancelamento_sem_multa_ate: "2026-10-01T13:30:00.000Z",
    ...parcial,
  };
}

describe("situacaoNoBalcao", () => {
  it("lê o status do núcleo e o relógio", () => {
    expect(situacaoNoBalcao(sessao({ status: "pending" }), AGORA)).toBe("sem_confirmacao");
    expect(situacaoNoBalcao(sessao({}), AGORA)).toBe("confirmado");
    expect(situacaoNoBalcao(sessao({ inicio: "2026-10-02T12:30:00.000Z" }), AGORA)).toBe(
      "atrasado",
    );
    expect(situacaoNoBalcao(sessao({ status: "completed" }), AGORA)).toBe("realizado");
    expect(situacaoNoBalcao(sessao({ status: "no_show" }), AGORA)).toBe("faltou");
    expect(situacaoNoBalcao(sessao({ status: "cancelled" }), AGORA)).toBe("cancelado");
  });
});

describe("faltaLiberada", () => {
  it("respeita a tolerância da clínica, minuto a minuto", () => {
    const s = sessao({
      inicio: "2026-10-02T12:30:00.000Z",
      falta_liberada_em: "2026-10-02T12:45:00.000Z",
    });
    expect(faltaLiberada(s, AGORA)).toBe(false);
    expect(faltaLiberada(s, new Date("2026-10-02T12:45:00.000Z"))).toBe(true);
  });

  it("compromisso sem modalidade não tem tolerância: vale a partir do início", () => {
    const s = sessao({
      modalidade: null,
      falta_liberada_em: null,
      inicio: "2026-10-02T12:30:00.000Z",
    });
    expect(faltaLiberada(s, AGORA)).toBe(true);
  });
});

describe("acoesDoBalcao", () => {
  it("sem confirmação, a ação principal é confirmar", () => {
    expect(acoesDoBalcao(sessao({ status: "pending" }), AGORA)[0]).toBe("confirmar");
  });

  it("atrasado e fora da tolerância, a principal é registrar a falta", () => {
    const s = sessao({
      inicio: "2026-10-02T12:00:00.000Z",
      falta_liberada_em: "2026-10-02T12:15:00.000Z",
    });
    expect(acoesDoBalcao(s, AGORA)[0]).toBe("faltou");
  });

  it("atrasado ainda dentro da tolerância: a falta existe, mas não em destaque", () => {
    const s = sessao({
      inicio: "2026-10-02T12:30:00.000Z",
      falta_liberada_em: "2026-10-02T12:45:00.000Z",
    });
    const acoes = acoesDoBalcao(s, AGORA);
    expect(acoes[0]).toBe("remarcar");
    expect(acoes).toContain("faltou");
  });

  it("confirmado e por vir, a principal é remarcar", () => {
    expect(acoesDoBalcao(sessao({}), AGORA)).toEqual(["remarcar", "whatsapp", "cancelar", "ficha"]);
  });

  it("horário encerrado só abre conversa e ficha", () => {
    expect(acoesDoBalcao(sessao({ status: "completed" }), AGORA)).toEqual(["whatsapp", "ficha"]);
  });

  it("sem telefone não oferece WhatsApp; sem paciente não oferece ficha", () => {
    const acoes = acoesDoBalcao(sessao({ paciente: null }), AGORA);
    expect(acoes).not.toContain("whatsapp");
    expect(acoes).not.toContain("ficha");
  });
});

describe("filaDoDia e contagemPorFiltro", () => {
  const dia = [
    sessao({ id: "c", inicio: "2026-10-02T14:00:00.000Z", status: "pending" }),
    sessao({ id: "a", inicio: "2026-10-02T11:00:00.000Z", status: "completed" }),
    sessao({ id: "b", inicio: "2026-10-02T12:30:00.000Z" }),
    sessao({ id: "d", inicio: "2026-10-02T15:00:00.000Z" }),
  ];

  it("ordena pelo relógio e filtra pela situação", () => {
    expect(filaDoDia(dia, AGORA, "hoje").map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(filaDoDia(dia, AGORA, "atrasado").map((s) => s.id)).toEqual(["b"]);
    expect(filaDoDia(dia, AGORA, "encerrado").map((s) => s.id)).toEqual(["a"]);
  });

  it("conta cada filtro", () => {
    expect(contagemPorFiltro(dia, AGORA)).toEqual({
      hoje: 4,
      sem_confirmacao: 1,
      a_caminho: 1,
      atrasado: 1,
      encerrado: 1,
    });
  });
});

describe("previaDaMulta", () => {
  it("é a mesma conta da rota: 30% do preço quando o paciente desmarca em cima da hora", () => {
    const m = previaDaMulta({
      sessao: sessao({}),
      agora: AGORA,
      politica: POLITICA_PADRAO,
      precoCents: 15000,
      pelaClinica: false,
    });
    expect(m?.percentual).toBe(30);
    expect(m?.valor_cents).toBe(4500);
  });

  it("sem multa quando a clínica desmarca, quando há antecedência ou fora da clínica", () => {
    const base = { agora: AGORA, politica: POLITICA_PADRAO, precoCents: 15000 };
    expect(previaDaMulta({ ...base, sessao: sessao({}), pelaClinica: true })).toBeNull();
    expect(
      previaDaMulta({
        ...base,
        sessao: sessao({ inicio: "2026-10-05T13:30:00.000Z" }),
        pelaClinica: false,
      }),
    ).toBeNull();
    expect(
      previaDaMulta({ ...base, sessao: sessao({ modalidade: null }), pelaClinica: false }),
    ).toBeNull();
  });
});
