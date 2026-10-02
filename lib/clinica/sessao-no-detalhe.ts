/**
 * O que o painel do compromisso precisa dizer sobre uma sessão da clínica antes que a recepção
 * aperte um botão: se cancelar agora gera multa e a partir de quando a falta pode ser registrada.
 *
 * Os prazos chegam prontos da grade (`GET /api/v1/clinica/agenda`, `falta_liberada_em` e
 * `cancelamento_sem_multa_ate`); aqui só se compara com o relógio. Puro, para testar sem tela.
 */
import type { PoliticaDaAgenda, SessaoDaGrade } from "./agenda";

export type AvisoDoCancelamento =
  { tipo: "sem_multa"; ate: Date } | { tipo: "com_multa"; percentual: number };

/**
 * `null` quando não há o que avisar: o compromisso não é sessão da clínica, ou a política está
 * com multa de 0%.
 */
export function avisoDoCancelamento(
  sessao: Pick<SessaoDaGrade, "cancelamento_sem_multa_ate"> | null,
  politica: Pick<PoliticaDaAgenda, "multa_cancelamento_pct">,
  agora: number,
): AvisoDoCancelamento | null {
  if (!sessao?.cancelamento_sem_multa_ate) return null;
  if (politica.multa_cancelamento_pct <= 0) return null;
  const ate = new Date(sessao.cancelamento_sem_multa_ate);
  if (agora < ate.getTime()) return { tipo: "sem_multa", ate };
  return { tipo: "com_multa", percentual: politica.multa_cancelamento_pct };
}

/** Até quando o botão de falta fica travado pela tolerância; `null` quando já pode. */
export function faltaTravadaAte(
  sessao: Pick<SessaoDaGrade, "falta_liberada_em"> | null,
  agora: number,
): Date | null {
  if (!sessao?.falta_liberada_em) return null;
  const liberada = new Date(sessao.falta_liberada_em);
  return agora < liberada.getTime() ? liberada : null;
}
