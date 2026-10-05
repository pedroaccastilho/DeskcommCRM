/**
 * A trava do relatório da gestão no servidor: além do degrau `manager` (que a rota já exige),
 * os perfis de quem chama têm de incluir Administrador, Gerente ou Financeiro.
 */
import { fail } from "@/lib/api/wrappers";
import { cargosDoUsuario } from "@/lib/clinica/cargos";
import type { Role } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

import { moduloClinicaNaoInstalado } from "./api";
import { veRelatoriosDaGestao } from "./gestao";

export async function recusaDoRelatorio(
  orgId: string,
  userId: string,
  role: Role,
  requestId: string,
): Promise<Response | null> {
  if (role === "admin") return null;
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
      return fail("internal_error", r.error.message, 500, { requestId });
    }
  }
  const cargos = cargosDoUsuario(
    role,
    cadastro.data ?? null,
    (gravados.data ?? []).map((g) => g.cargo as string),
  );
  if (veRelatoriosDaGestao(role, cargos)) return null;
  return fail(
    "forbidden",
    "Os relatórios da gestão são para Administrador, Gerente e Financeiro.",
    403,
    { requestId },
  );
}
