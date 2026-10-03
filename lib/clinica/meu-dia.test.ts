import { describe, expect, it } from "vitest";

import type { SessaoDaGrade } from "./agenda";
import {
  minhasSessoes,
  pacienteDaVez,
  proximaJaMarcada,
  proximoDoDia,
  ultimoRegistro,
  valoresParaRepetir,
  type RegistroAnterior,
} from "./meu-dia";

// 9h40 em São Paulo (12h40 UTC).
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
    falta_liberada_em: null,
    cancelamento_sem_multa_ate: null,
    ...parcial,
  };
}

describe("minhasSessoes", () => {
  it("só os horários de quem está logado, em ordem e sem os cancelados", () => {
    const dia = [
      sessao({ id: "b", inicio: "2026-10-02T15:00:00.000Z" }),
      sessao({ id: "outro", profissional_user_id: "rafael" }),
      sessao({ id: "a", inicio: "2026-10-02T11:00:00.000Z", status: "completed" }),
      sessao({ id: "c", status: "cancelled" }),
    ];
    const minhas = minhasSessoes(dia, "camila", AGORA);
    expect(minhas.map((s) => s.id)).toEqual(["a", "b"]);
    expect(minhas[0]!.situacao).toBe("realizado");
  });
});

describe("pacienteDaVez", () => {
  it("é quem está na sala agora, mesmo depois do horário de início", () => {
    const dia = minhasSessoes(
      [
        sessao({ id: "feito", inicio: "2026-10-02T11:00:00.000Z", status: "completed" }),
        sessao({
          id: "agora",
          inicio: "2026-10-02T12:20:00.000Z",
          fim: "2026-10-02T13:10:00.000Z",
        }),
        sessao({ id: "depois", inicio: "2026-10-02T13:30:00.000Z" }),
      ],
      "camila",
      AGORA,
    );
    expect(pacienteDaVez(dia, AGORA)?.id).toBe("agora");
  });

  it("sem horário aberto, abre o último do dia", () => {
    const dia = minhasSessoes(
      [
        sessao({ id: "a", inicio: "2026-10-02T10:00:00.000Z", status: "completed" }),
        sessao({ id: "b", inicio: "2026-10-02T11:00:00.000Z", status: "no_show" }),
      ],
      "camila",
      AGORA,
    );
    expect(pacienteDaVez(dia, AGORA)?.id).toBe("b");
    expect(pacienteDaVez([], AGORA)).toBeNull();
  });
});

describe("repetir a conduta", () => {
  const registros: RegistroAnterior[] = [
    {
      modalidade: "fisioterapia",
      tipo: "evolucao",
      conteudo: { dor: 6, conduta: "Liberação miofascial", plano: "Progredir carga" },
      assinado_em: "2026-09-28T13:00:00.000Z",
    },
    {
      modalidade: "fisioterapia",
      tipo: "evolucao",
      conteudo: { dor: 4, conduta: "Fortalecimento de glúteo", plano: "Manter" },
      assinado_em: "2026-09-30T13:00:00.000Z",
    },
    {
      modalidade: "pilates",
      tipo: "evolucao",
      conteudo: { exercicios: "Ponte" },
      assinado_em: "2026-10-01T13:00:00.000Z",
    },
  ];

  it("pega o último registro da modalidade e copia o tratamento, nunca a dor", () => {
    const ultimo = ultimoRegistro(registros, "fisioterapia");
    expect(ultimo?.conteudo.conduta).toBe("Fortalecimento de glúteo");
    expect(valoresParaRepetir(ultimo)).toEqual({
      conduta: "Fortalecimento de glúteo",
      plano: "Manter",
    });
  });

  it("depois da avaliação de fisioterapia, a conduta vem das condutas previstas", () => {
    const avaliacao: RegistroAnterior = {
      modalidade: "fisioterapia",
      tipo: "avaliacao",
      conteudo: { diagnostico_fisioterapeutico: "Lombalgia", condutas_previstas: "Cinesioterapia" },
      assinado_em: "2026-09-20T13:00:00.000Z",
    };
    expect(valoresParaRepetir(avaliacao)).toEqual({ conduta: "Cinesioterapia" });
  });

  it("sem registro anterior não há o que repetir", () => {
    expect(ultimoRegistro(registros, "medicina")).toBeNull();
    expect(valoresParaRepetir(null)).toEqual({});
  });
});

describe("proximaJaMarcada", () => {
  it("a primeira sessão futura não cancelada, fora a que acabou de ser atendida", () => {
    const compromissos = [
      { id: "hoje", iniciaEm: "2026-10-02T13:30:00.000Z", situacao: "completed" },
      { id: "cancelada", iniciaEm: "2026-10-05T13:30:00.000Z", situacao: "cancelled" },
      { id: "dia-9", iniciaEm: "2026-10-09T13:30:00.000Z", situacao: "pending" },
      { id: "dia-7", iniciaEm: "2026-10-07T13:30:00.000Z", situacao: "confirmed" },
      { id: "ontem", iniciaEm: "2026-10-01T13:30:00.000Z", situacao: "completed" },
    ];
    expect(proximaJaMarcada(compromissos, "hoje", AGORA)?.id).toBe("dia-7");
  });

  it("sem nada marcado à frente, nenhuma: é quando o profissional precisa marcar", () => {
    const compromissos = [
      { id: "hoje", iniciaEm: "2026-10-02T13:30:00.000Z", situacao: "pending" },
    ];
    expect(proximaJaMarcada(compromissos, "hoje", AGORA)).toBeNull();
  });
});

describe("proximoDoDia", () => {
  it("o próximo horário aberto depois do atual, pulando quem já foi atendido ou faltou", () => {
    const minhas = minhasSessoes(
      [
        sessao({
          id: "atual",
          inicio: "2026-10-02T12:30:00.000Z",
          fim: "2026-10-02T13:20:00.000Z",
        }),
        sessao({ id: "feito", inicio: "2026-10-02T13:30:00.000Z", status: "completed" }),
        sessao({
          id: "seguinte",
          inicio: "2026-10-02T15:00:00.000Z",
          fim: "2026-10-02T15:50:00.000Z",
        }),
      ],
      "camila",
      AGORA,
    );
    expect(proximoDoDia(minhas, "atual")?.id).toBe("seguinte");
    expect(proximoDoDia(minhas, "seguinte")).toBeNull();
  });
});
