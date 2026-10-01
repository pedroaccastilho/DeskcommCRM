/**
 * Editar ou desativar um profissional de saúde. Nunca apagar: o cadastro é a origem da
 * assinatura dos registros já feitos. Só `admin` (mesma régua da RLS da migration 9001).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { editarProfissionalSchema } from "@/lib/clinica/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_profissionais" });
  if (!authz.ok) return authz.response;

  const { id } = await ctx.params;
  const lido = editarProfissionalSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const mudancas: Record<string, unknown> = Object.fromEntries(
    Object.entries(lido.data).filter(([, v]) => v !== undefined),
  );
  mudancas.updated_at = new Date().toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_profissionais")
    .update(mudancas)
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(
      "id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo",
    )
    .maybeSingle();

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", "Profissional não encontrado.", 404, { requestId });

  await audit({
    action: "clinica.profissional_alterado",
    resourceType: "clinica_profissional",
    resourceId: data.id,
    requestId,
    metadata: {
      campos: Object.keys(mudancas).filter((k) => k !== "updated_at"),
      ativo: data.ativo,
    },
  });

  return ok(data, { requestId });
}
