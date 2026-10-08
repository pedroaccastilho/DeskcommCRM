/**
 * A tela "Hoje" da interface nova (`/hoje`): o dia da clínica em perguntas simples.
 *
 *  - Quem já está NA CLÍNICA (chegou e espera na recepção, ou já está sendo atendido)?
 *  - Quem passou do horário e ainda não chegou?
 *  - O que já passou e ninguém fechou (realizado ou faltou)?
 *  - Quem ainda não confirmou?
 *  - Quem já confirmou e está a caminho?
 *
 * A chegada e o início do atendimento são as etapas do Balcão e do Meu dia da versão atual
 * (`lib/clinica/balcao.ts`, migration 9007): a mesma régua, para as duas telas dizerem o mesmo.
 *
 * Regra pura: o `agora` entra por parâmetro, a rede fica na tela.
 */
import type { SessaoDaGrade } from "@/lib/clinica/agenda";

const ABERTOS = new Set(["pending", "confirmed"]);

export type Momento =
  | "em_atendimento"
  | "na_recepcao"
  | "atrasado"
  | "agora"
  | "para_fechar"
  | "sem_confirmacao"
  | "confirmada"
  | "encerrada";

/**
 * Em que pé está a sessão. Sessão da clínica (com modalidade) tem chegada: começou o horário e
 * ninguém marcou que o paciente chegou, ele está ATRASADO, como no Balcão. Compromisso sem
 * modalidade não tem chegada, então o horário em curso é só "agora".
 */
export function momentoDa(sessao: SessaoDaGrade, agora: Date): Momento {
  if (!ABERTOS.has(sessao.status)) return "encerrada";
  if (sessao.atendimento_iniciado_em) return "em_atendimento";
  if (sessao.chegou_em) return "na_recepcao";
  const t = agora.getTime();
  if (new Date(sessao.fim).getTime() <= t) return "para_fechar";
  if (new Date(sessao.inicio).getTime() <= t) return sessao.modalidade ? "atrasado" : "agora";
  return sessao.status === "pending" ? "sem_confirmacao" : "confirmada";
}

/** O paciente está dentro da clínica: esperando na recepção ou já em atendimento. */
export function naClinica(momento: Momento): boolean {
  return momento === "na_recepcao" || momento === "em_atendimento";
}

export interface DiaArrumado {
  /** Chegou ou está em atendimento: o filtro "Na clínica" do Balcão. */
  naClinica: SessaoDaGrade[];
  atrasadas: SessaoDaGrade[];
  agora: SessaoDaGrade[];
  paraFechar: SessaoDaGrade[];
  semConfirmacao: SessaoDaGrade[];
  confirmadas: SessaoDaGrade[];
  encerradas: SessaoDaGrade[];
  /** A próxima sessão que ainda não começou e cujo paciente não chegou: o cartão grande do topo. */
  proxima: SessaoDaGrade | null;
  total: number;
  realizadas: number;
}

export function arrumarDia(sessoes: readonly SessaoDaGrade[], agora: Date): DiaArrumado {
  const ordenadas = [...sessoes].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const dia: DiaArrumado = {
    naClinica: [],
    atrasadas: [],
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
      case "em_atendimento":
      case "na_recepcao":
        dia.naClinica.push(s);
        break;
      case "atrasado":
        dia.atrasadas.push(s);
        break;
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

/**
 * Depois de assinar a evolução, o "Próximo paciente" do Meu dia: o próximo horário do dia, na
 * ordem do relógio, que ainda está em aberto.
 */
export function proximoAberto(
  sessoes: readonly SessaoDaGrade[],
  atualId: string,
  agora: Date,
): SessaoDaGrade | null {
  const ordenadas = [...sessoes].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const i = ordenadas.findIndex((s) => s.id === atualId);
  if (i < 0) return null;
  return ordenadas.slice(i + 1).find((s) => momentoDa(s, agora) !== "encerrada") ?? null;
}
