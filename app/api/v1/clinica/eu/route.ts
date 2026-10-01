/**
 * O MÓDULO CLÍNICA PARA QUEM ESTÁ LOGADO: está instalado? sou profissional de saúde aqui?
 *
 * É o que a ficha do paciente pergunta para decidir se mostra a aba "Prontuário" e se mostra o
 * formulário de registro. Não decide acesso: quem decide é a RLS (fn_clinica_e_profissional).
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_profissionais" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_profissionais")
    .select("id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", authz.user.id)
    .maybeSingle();

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return ok({ instalado: false, profissional: null, ve_acessos: false }, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  // Sessão de suporte nunca lê prontuário (a RLS garante); a tela já não oferece o formulário.
  const profissional = data && data.ativo && !authz.user.support ? data : null;
  // A trilha de acessos é do administrador da clínica (RLS de `prontuario_acessos`), seja ele
  // profissional de saúde ou não. Sessão de suporte não vê.
  const ve_acessos = authz.org.role === "admin" && !authz.user.support;
  return ok({ instalado: true, profissional, ve_acessos }, { requestId });
}
