/**
 * QUEM DECIDE SE A MULTA É COBRADA OU ISENTADA (pedido do Pedro, 2026-10-09: "preciso conseguir
 * indicar se o paciente vai pagar a multa ou não").
 *
 * A multa nasce `pendente` (a cobrar) quando o paciente cancela em cima da hora. Isentar, e
 * voltar a cobrar uma isenta, é de Administrador, Gerente e Recepção; os perfis de saúde,
 * Financeiro e Jurídico só leem. Os perfis SOMAM: a fisioterapeuta que também é gerente decide.
 *
 * Esta é a régua única: as rotas recusam com ela (`lib/clinica/gestao-servidor.ts`) e a interface
 * nova esconde os botões com ela.
 */
import type { Role } from "@/lib/auth/types";

/** Perfis que isentam e voltam a cobrar multa. */
export const CARGOS_QUE_DECIDEM_MULTA = ["administrador", "gerente", "recepcao"] as const;

export const RECUSA_DA_MULTA =
  "Isentar ou voltar a cobrar multa é da recepção, da gerência e do administrador.";

/**
 * O banco exige motivo em toda isenção (`clinica_multas_isencao_justificada`); quando quem isenta
 * não escreve nenhum, fica este.
 */
export const MOTIVO_PADRAO_DA_ISENCAO = "Isenta sem motivo informado";

export function decideMulta(role: Role, cargos: readonly string[]): boolean {
  if (role === "viewer") return false;
  if (role === "admin") return true;
  return cargos.some((c) => (CARGOS_QUE_DECIDEM_MULTA as readonly string[]).includes(c));
}

/** O motivo que vai para o banco: o escrito, ou o padrão quando veio em branco. */
export function motivoDaIsencao(motivo: string | undefined | null): string {
  const limpo = (motivo ?? "").trim();
  return limpo.length > 0 ? limpo : MOTIVO_PADRAO_DA_ISENCAO;
}
