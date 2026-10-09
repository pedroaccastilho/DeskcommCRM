/**
 * A TRAVA NO SERVIDOR de `lib/clinica/presenca.ts`: quem não é Administrador, Gerente nem Recepção
 * só registra a sessão da própria agenda.
 *
 * Duas portas chamam:
 *  - `lib/agenda/regras-de-modulo.ts` (`antesDeMarcarPresenca`), quando o status muda pelo handler
 *    da agenda do núcleo: confirmar, "Realizado", "Faltou" e desfazer um desfecho;
 *  - `app/api/v1/clinica/agenda/[id]/etapa`, para "Chegou", "Iniciar atendimento" e "Desfazer".
 *
 * Só sessão da clínica (o tipo tem modalidade) e só gente (`actor.type === "user"`): o agente de
 * IA e o webhook não têm agenda própria, e o que os governa continua sendo o papel do token.
 *
 * Os perfis são lidos do banco a cada chamada (os gravados ou, sem nenhum, os calculados do papel
 * e do cadastro de profissional), nunca do corpo. Client de serviço, sempre filtrado pela
 * organização que a rota já validou.
 */
import { ApiError } from "@/lib/api/types";
import type { Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { moduloClinicaNaoInstalado } from "./api";
import { cargosDoUsuario } from "./cargos";
import { RECUSA_DA_SESSAO_DE_OUTRO, podeMarcarASessao } from "./presenca";

export const CODIGO_DA_SESSAO_DE_OUTRO = "clinica_sessao_de_outro_profissional";

/** Os perfis de quem chama, lidos do banco. */
async function perfisNoBanco(
  orgId: string,
  userId: string,
): Promise<{ role: Role; cargos: string[] } | null> {
  const admin = createAdminClient();
  const [vinculo, cadastro, gravados] = await Promise.all([
    admin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle(),
    admin
      .from("clinica_profissionais")
      .select("conselho, ativo")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("clinica_cargos_membro")
      .select("cargo")
      .eq("organization_id", orgId)
      .eq("user_id", userId),
  ]);
  if (vinculo.error) throw vinculo.error;
  for (const r of [cadastro, gravados]) {
    if (r.error && !moduloClinicaNaoInstalado(r.error)) throw r.error;
  }
  const role = (vinculo.data?.role as Role | undefined) ?? null;
  if (!role) return null;
  return {
    role,
    cargos: cargosDoUsuario(
      role,
      (cadastro.data as { conselho: string; ativo: boolean } | null) ?? null,
      ((gravados.data as { cargo: string }[] | null) ?? []).map((g) => g.cargo),
    ),
  };
}

/**
 * Recusa (ApiError 403) quando a pessoa não pode registrar esta sessão. Quem chama já conferiu
 * que é sessão da clínica.
 */
export async function exigePodeMarcarASessao(
  orgId: string,
  userId: string,
  donoId: string | null,
  requestId: string,
): Promise<void> {
  if (donoId !== null && donoId === userId) return;
  const perfis = await perfisNoBanco(orgId, userId);
  if (perfis && podeMarcarASessao({ ...perfis, userId, donoId })) return;
  throw new ApiError(403, CODIGO_DA_SESSAO_DE_OUTRO, undefined, requestId, RECUSA_DA_SESSAO_DE_OUTRO);
}
