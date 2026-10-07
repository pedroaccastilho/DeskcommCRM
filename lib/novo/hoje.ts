/**
 * A tela "Hoje" da interface nova (`/hoje`): o dia da clínica em quatro perguntas simples.
 *
 *  - Quem está sendo atendido AGORA?
 *  - O que já passou e ninguém fechou (realizado ou faltou)?
 *  - Quem ainda não confirmou?
 *  - Quem já confirmou e está a caminho?
 *
 * Regra pura: o `agora` entra por parâmetro, a rede fica na tela.
 */
import type { SessaoDaGrade } from "@/lib/clinica/agenda";

const ABERTOS = new Set(["pending", "confirmed"]);

export type Momento = "agora" | "para_fechar" | "sem_confirmacao" | "confirmada" | "encerrada";

export function momentoDa(sessao: SessaoDaGrade, agora: Date): Momento {
  if (!ABERTOS.has(sessao.status)) return "encerrada";
  const t = agora.getTime();
  if (new Date(sessao.fim).getTime() <= t) return "para_fechar";
  if (new Date(sessao.inicio).getTime() <= t) return "agora";
  return sessao.status === "pending" ? "sem_confirmacao" : "confirmada";
}

export interface DiaArrumado {
  agora: SessaoDaGrade[];
  paraFechar: SessaoDaGrade[];
  semConfirmacao: SessaoDaGrade[];
  confirmadas: SessaoDaGrade[];
  encerradas: SessaoDaGrade[];
  /** A próxima sessão que ainda não começou — o cartão grande do topo. */
  proxima: SessaoDaGrade | null;
  total: number;
  realizadas: number;
}

export function arrumarDia(sessoes: readonly SessaoDaGrade[], agora: Date): DiaArrumado {
  const ordenadas = [...sessoes].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const dia: DiaArrumado = {
    agora: [],
    paraFechar: [],
    semConfirmacao: [],
    confirmadas: [],
    encerradas: [],
    proxima: null,
    total: 0,
    realizadas: 0,
  };
  for (const s of ordenadas) {
    if (s.status !== "cancelled") dia.total += 1;
    if (s.status === "completed") dia.realizadas += 1;
    switch (momentoDa(s, agora)) {
      case "agora":
        dia.agora.push(s);
        break;
      case "para_fechar":
        dia.paraFechar.push(s);
        break;
      case "sem_confirmacao":
        dia.semConfirmacao.push(s);
        dia.proxima ??= s;
        break;
      case "confirmada":
        dia.confirmadas.push(s);
        dia.proxima ??= s;
        break;
      case "encerrada":
        dia.encerradas.push(s);
        break;
    }
  }
  return dia;
}

/** Só as sessões de quem atende, quando a tela é a de um profissional. */
export function soAsMinhas(
  sessoes: readonly SessaoDaGrade[],
  meuId: string | null,
): SessaoDaGrade[] {
  if (!meuId) return [...sessoes];
  return sessoes.filter((s) => s.profissional_user_id === meuId);
}

/** "Bom dia", "Boa tarde" ou "Boa noite", pela hora do relógio da clínica. */
export function saudacao(hora: number): string {
  if (hora < 5) return "Boa noite";
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** Quanto falta, em português de gente: "agora", "em 12 min", "em 1h 05", "há 20 min". */
export function quantoFalta(inicio: Date, agora: Date): string {
  const min = Math.round((inicio.getTime() - agora.getTime()) / 60_000);
  if (Math.abs(min) < 1) return "agora";
  const abs = Math.abs(min);
  const texto =
    abs < 60
      ? `${abs} min`
      : `${Math.floor(abs / 60)}h${abs % 60 ? ` ${String(abs % 60).padStart(2, "0")}` : ""}`;
  return min > 0 ? `em ${texto}` : `há ${texto}`;
}

/**
 * A janela de horas que a linha do dia desenha: do expediente padrão (7h às 20h) esticada para
 * caber a primeira e a última sessão. Em horas inteiras do relógio da clínica.
 */
export function janelaDoDia(horasDasSessoes: ReadonlyArray<{ inicio: number; fim: number }>): {
  de: number;
  ate: number;
} {
  let de = 7;
  let ate = 20;
  for (const h of horasDasSessoes) {
    de = Math.min(de, Math.floor(h.inicio));
    ate = Math.max(ate, Math.ceil(h.fim));
  }
  return { de: Math.max(0, de), ate: Math.min(24, Math.max(ate, de + 1)) };
}

/** Posição (0 a 1) de uma hora decimal dentro da janela. */
export function posicaoNaJanela(hora: number, janela: { de: number; ate: number }): number {
  const p = (hora - janela.de) / (janela.ate - janela.de);
  return Math.min(1, Math.max(0, p));
}
