/**
 * As travas por PERFIL no servidor, além do degrau que a rota já exige:
 *  - o relatório da gestão: Administrador, Gerente ou Financeiro;
 *  - LGPD e a trilha de quem abriu o prontuário: Administrador ou Jurídico.
 */
import { fail } from "@/lib/api/wrappers";
import { cargosDoUsuario } from "@/lib/clinica/cargos";
import type { ActiveOrg, AuthUser, Role } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

import { moduloClinicaNaoInstalado } from "./api";
import { veLgpdEAcessos, veRelatoriosDaGestao } from "./gestao";

/** Os perfis de quem chama (os gravados ou, sem nenhum, os calculados), ou a resposta de erro. */
async function cargosDoChamador(
  orgId: string,
  userId: string,
  role: Role,
  requestId: string,
): Promise<{ cargos: string[] } | { erro: Response }> {
  const supabase = await createClient();
  const [cadastro, gravados] = await Promise.all([
    supabase
      .from("clinica_profissionais")
      .select("conselho, ativo")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("clinica_cargos_membro")
      .select("cargo")
      .eq("organization_id", orgId)
      .eq("user_id", userId),
  ]);
  for (const r of [cadastro, gravados]) {
    if (r.error && !moduloClinicaNaoInstalado(r.error)) {
      return { erro: fail("internal_error", r.error.message, 500, { requestId }) };
    }
  }
  return {
    cargos: cargosDoUsuario(
      role,
      cadastro.data ?? null,
      (gravados.data ?? []).map((g) => g.cargo as string),
    ),
  };
}

export async function recusaDoRelatorio(
  orgId: string,
  userId: string,
  role: Role,
  requestId: string,
): Promise<Response | null> {
  if (role === "admin") return null;
  const lidos = await cargosDoChamador(orgId, userId, role, requestId);
  if ("erro" in lidos) return lidos.erro;
  if (veRelatoriosDaGestao(role, lidos.cargos)) return null;
  return fail(
    "forbidden",
    "Os relatórios da gestão são para Administrador, Gerente e Financeiro.",
    403,
    { requestId },
  );
}

/**
 * LGPD e "quem abriu o prontuário": do Administrador e do perfil Jurídico (Pedro, 2026-10-04:
 * "Jurídico = LGPD, auditoria, quem abriu, sem conteúdo clínico"). A rota exige o degrau
 * `manager` antes; aqui fica a soma fina dos perfis. O platform admin segue entrando onde já
 * entrava: leitura com qualquer escopo, escrita só com o escopo `full`.
 */
export async function recusaForaDoJuridico(
  authz: { user: AuthUser; org: ActiveOrg },
  requestId: string,
  {
    plataforma,
  }: {
    /** O mesmo `allowPlatformAdmin` que a rota passou a `requireRole` (`false` = não entra). */
    plataforma: "leitura" | "escrita" | false;
  },
): Promise<Response | null> {
  const { user, org } = authz;
  if (org.role === "admin") return null;
  if (
    plataforma !== false &&
    user.is_platform_admin &&
    !user.support &&
    (plataforma === "leitura" || user.platform_admin_scope === "full")
  ) {
    return null;
  }
  const lidos = await cargosDoChamador(org.orgId, user.id, org.role, requestId);
  if ("erro" in lidos) return lidos.erro;
  if (veLgpdEAcessos(org.role, lidos.cargos)) return null;
  return fail(
    "forbidden",
    "LGPD e a trilha de acessos ao prontuário são do Administrador e do Jurídico.",
    403,
    { requestId },
  );
}

/** A mesma regra para as PÁGINAS de LGPD (que redirecionam em vez de responder 403). */
export async function telaDeLgpdLiberada(
  user: Pick<AuthUser, "id" | "is_platform_admin" | "support">,
  org: Pick<ActiveOrg, "orgId" | "role">,
): Promise<boolean> {
  if ((user.is_platform_admin && !user.support) || org.role === "admin") return true;
  if (org.role !== "manager") return false;
  const lidos = await cargosDoChamador(org.orgId, user.id, org.role, "");
  return "cargos" in lidos && veLgpdEAcessos(org.role, lidos.cargos);
}
