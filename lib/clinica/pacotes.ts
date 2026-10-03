/**
 * PACOTES DE SESSÕES — as contas do pacote, sem banco (módulo clínica, migration 9004).
 *
 * Regras da TOQ (`/mnt/project-files/produto/regras-de-negocio.md`, seções 4 e 5):
 * - sessão realizada e falta sem aviso gastam uma sessão; cancelamento não gasta (o do paciente
 *   em cima da hora gera multa, o da clínica não gera nada);
 * - o pacote vale N dias a partir da compra (60 no padrão), e sessão vencida não é devolvida;
 * - dentro do pacote, a multa é calculada sobre o valor da sessão no pacote (total / sessões);
 * - no cancelamento do pacote, o reembolso sugerido é o das sessões restantes pelo preço avulso.
 *
 * O saldo é CALCULADO (sessões do pacote menos as gastas), nunca guardado: DIRC "calcular".
 */
import type { Modalidade } from "./vocabulario";
import { ROTULO_DA_MODALIDADE } from "./vocabulario";

export const SITUACOES_DO_PACOTE = ["ativo", "esgotado", "vencido", "cancelado"] as const;
export type SituacaoDoPacote = (typeof SITUACOES_DO_PACOTE)[number];

export type MotivoDoConsumo = "realizada" | "falta";

/**
 * O que a mudança na agenda faz com a sessão no pacote.
 *
 * `null` = a sessão deixou de contar (cancelada, remarcada, voltou para agendada ou confirmada):
 * se estava lançada, volta para o saldo. `undefined` = a transição não diz nada sobre o pacote.
 */
export function consumoDaTransicao(transicao: string): MotivoDoConsumo | null | undefined {
  switch (transicao) {
    case "completed":
      return "realizada";
    case "no_show":
      return "falta";
    case "cancelled":
    case "rescheduled":
    case "scheduled":
    case "confirmed":
      return null;
    default:
      return undefined;
  }
}

export interface PacoteParaSituacao {
  status: "ativo" | "cancelado";
  sessoes_total: number;
  sessoes_usadas: number;
  valido_ate: string;
}

export function saldoDoPacote(
  p: Pick<PacoteParaSituacao, "sessoes_total" | "sessoes_usadas">,
): number {
  return Math.max(0, p.sessoes_total - p.sessoes_usadas);
}

/** Cancelado vence esgotado, que vence vencido: é a ordem do que a recepção precisa saber. */
export function situacaoDoPacote(
  p: PacoteParaSituacao,
  agora: Date = new Date(),
): SituacaoDoPacote {
  if (p.status === "cancelado") return "cancelado";
  if (saldoDoPacote(p) === 0) return "esgotado";
  if (new Date(p.valido_ate).getTime() < agora.getTime()) return "vencido";
  return "ativo";
}

/** Pacote ativo com poucas sessões: hora de oferecer a renovação. */
export function precisaRenovar(
  p: PacoteParaSituacao,
  limite: number,
  agora: Date = new Date(),
): boolean {
  return situacaoDoPacote(p, agora) === "ativo" && saldoDoPacote(p) <= limite;
}

/** Quanto vale uma sessão dentro do pacote, ou `null` quando o pacote não tem valor. */
export function valorDaSessaoNoPacote(
  valorCents: number | null,
  sessoesTotal: number,
): number | null {
  if (valorCents === null || sessoesTotal <= 0) return null;
  return Math.round(valorCents / sessoesTotal);
}

/**
 * Reembolso sugerido no cancelamento: sessões restantes pelo preço AVULSO (a sessão fora do
 * pacote é mais cara, e foi o desconto do pacote que o paciente deixou de cumprir). Nunca passa
 * do que foi pago. `null` quando falta o preço avulso: quem decide é a gerência.
 */
export function reembolsoSugerido(args: {
  restantes: number;
  precoAvulsoCents: number | null;
  valorPagoCents: number | null;
}): number | null {
  if (args.precoAvulsoCents === null) return null;
  const pelasRestantes = Math.max(0, args.restantes) * args.precoAvulsoCents;
  if (args.valorPagoCents === null) return pelasRestantes;
  return Math.min(pelasRestantes, args.valorPagoCents);
}

/** Nome do pacote quando quem vende não escolhe um do catálogo. */
export function nomePadraoDoPacote(sessoes: number, modalidade: Modalidade): string {
  return `${ROTULO_DA_MODALIDADE[modalidade]} — ${sessoes} ${sessoes === 1 ? "sessão" : "sessões"}`;
}

/** Fim da validade: N dias depois da compra. */
export function validoAte(compradoEm: Date, validadeDias: number): Date {
  return new Date(compradoEm.getTime() + validadeDias * 24 * 60 * 60 * 1000);
}
