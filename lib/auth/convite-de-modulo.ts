/**
 * O PONTO DE EXTENSÃO DO ACEITE DE CONVITE PARA MÓDULOS (ADR-0002) — hoje, só o módulo clínica
 * (migration 9008: o cargo de saúde escolhido no convite vira o cadastro de profissional).
 *
 * `aplicarConvite` chama esta função e mais nada do módulo, DEPOIS de gravar o vínculo. Nunca
 * lança: a pessoa já é membro, e falhar aqui não pode devolver erro a quem aceitou. Sem o módulo,
 * não faz nada (DoD 18, destino "ambos": o núcleo ganha o ponto, o módulo é o consumidor).
 */
import { aplicarCargoDoConvite } from "@/lib/clinica/cargo-do-convite";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export async function depoisDoAceite(params: {
  inviteId: string;
  orgId: string;
  userId: string;
  requestId?: string | null;
}): Promise<void> {
  try {
    await aplicarCargoDoConvite(createAdminClient(), params);
  } catch (err) {
    logger.error("[convite] regra de módulo depois do aceite falhou", {
      organization_id: params.orgId,
      invite_id: params.inviteId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
