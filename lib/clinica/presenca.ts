/**
 * QUEM MARCA O QUE ACONTECEU NUMA SESSÃO DA CLÍNICA (pedido do Pedro, 2026-10-09).
 *
 * "Eu como fisioterapeuta só posso confirmar as minhas consultas. Não posso confirmar a consulta
 * do médico, e o médico também não pode dar a minha. O gerente e o administrador podem todas, e a
 * recepção também."
 *
 * Vale para tudo o que registra a sessão: confirmar, "Chegou", "Iniciar atendimento", "Desfazer
 * chegada", "Realizado" e "Faltou". Quem marca de TODAS: Administrador, Gerente e Recepção. O
 * resto (os perfis de saúde, e também Financeiro e Jurídico sem um desses três) só marca a sessão
 * de que é o profissional (`owner_user_id`). Os perfis SOMAM: a fisioterapeuta que também é
 * gerente marca todas.
 *
 * Esta é a régua única: a rota (`lib/clinica/presenca-servidor.ts`) recusa com ela, e a interface
 * nova esconde os botões com ela.
 */
import type { Role } from "@/lib/auth/types";

/** Perfis que marcam a sessão de qualquer profissional. */
export const CARGOS_QUE_MARCAM_TODAS = ["administrador", "gerente", "recepcao"] as const;

export const RECUSA_DA_SESSAO_DE_OUTRO =
  "Esta sessão é da agenda de outro profissional. Só quem atende, a recepção, a gerência e o " +
  "administrador registram presença, chegada ou falta dela.";

export function marcaSessaoDeTodos(role: Role, cargos: readonly string[]): boolean {
  if (role === "admin") return true;
  return cargos.some((c) => (CARGOS_QUE_MARCAM_TODAS as readonly string[]).includes(c));
}

export function podeMarcarASessao({
  role,
  cargos,
  userId,
  donoId,
}: {
  role: Role;
  cargos: readonly string[];
  userId: string;
  donoId: string | null;
}): boolean {
  if (marcaSessaoDeTodos(role, cargos)) return true;
  return donoId !== null && donoId === userId;
}
