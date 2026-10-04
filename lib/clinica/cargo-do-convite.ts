/**
 * O ACEITE de um convite com perfis (migration 9008): a pessoa acabou de virar membro, e os
 * perfis que o administrador escolheu viram os perfis dela; com perfil de saúde, o registro do
 * conselho vira o cadastro de profissional.
 *
 * Papel e menu já vieram no próprio convite do núcleo; aqui nascem a lista de perfis
 * (`clinica_cargos_membro`) e o cadastro em `clinica_profissionais`, que é o que dá acesso ao
 * prontuário e à assinatura. Chamado por `lib/auth/convite-de-modulo.ts`, com o client
 * service-role: a organização e o convite vêm do token assinado, o usuário de quem aceitou. Sem o
 * módulo, ou sem linha, não faz nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/audit";

import { moduloClinicaNaoInstalado } from "./api";
import { SAUDE_DO_CARGO, cargoDeSaudeDe, ehCargo } from "./cargos";
import { gravarCargosDoMembro } from "./equipe-servidor";

export async function aplicarCargoDoConvite(
  admin: SupabaseClient,
  params: { inviteId: string; orgId: string; userId: string; requestId?: string | null },
): Promise<void> {
  const { inviteId, orgId, userId } = params;
  const { data: pendente, error } = await admin
    .from("clinica_convites_cargos")
    .select("cargos, nome_profissional, registro_numero, registro_uf")
    .eq("invite_id", inviteId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) return;
    throw new Error(error.message);
  }
  if (!pendente) return;

  const cargos = ((pendente.cargos as string[]) ?? []).filter(ehCargo);
  const gravou = await gravarCargosDoMembro(admin, { orgId, userId, cargos, definidoPor: null });
  if (gravou.error) throw new Error(gravou.error.message);

  const saude = cargoDeSaudeDe(cargos);
  let profissionalId: string | null = null;
  if (saude && pendente.nome_profissional && pendente.registro_numero && pendente.registro_uf) {
    const { data: gravado, error: gravarErro } = await admin
      .from("clinica_profissionais")
      .upsert(
        {
          organization_id: orgId,
          user_id: userId,
          nome_profissional: pendente.nome_profissional,
          registro_numero: pendente.registro_numero,
          registro_uf: pendente.registro_uf,
          ...SAUDE_DO_CARGO[saude],
          ativo: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id" },
      )
      .select("id")
      .single();
    if (gravarErro) throw new Error(gravarErro.message);
    profissionalId = gravado.id as string;
  }

  await admin
    .from("clinica_convites_cargos")
    .delete()
    .eq("invite_id", inviteId)
    .eq("organization_id", orgId);

  await audit({
    action: "clinica.cargo_do_convite_aplicado",
    actorUserId: userId,
    organizationId: orgId,
    resourceType: "membership",
    resourceId: userId,
    requestId: params.requestId ?? null,
    metadata: { invite_id: inviteId, cargos, profissional_id: profissionalId },
  });
}
