/**
 * ALTERAR UMA ORIGEM DA LISTA (módulo clínica, migration 9005).
 *
 * PATCH { nome?, ativo?, ordem? } — só o administrador. O tipo não muda: os pacientes já
 * registrados contaram o que ele pedia. Tirar da lista é `ativo: false`; não há DELETE, porque
 * paciente registrado aponta para cá (o banco recusa apagar origem em uso).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { origemPatchSchema } from "@/lib/clinica/origens-schemas";
import { COLUNAS_DA_ORIGEM } from "@/lib/clinica/origens-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_origens" });
  if (!authz.ok) return authz.response;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Origem não encontrada.", 404, { requestId });
  }
  const lido = origemPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const { data, error } = await supabase
    .from("clinica_origens")
    .update({ ...lido.data, updated_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("id", id)
    .select(COLUNAS_DA_ORIGEM)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma origem com esse nome.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) return fail("not_found", "Origem não encontrada.", 404, { requestId });

  await audit({
    action: "clinica.origem_alterada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_origem",
    resourceId: id,
    requestId,
    metadata: { campos: Object.keys(lido.data), ativo: data.ativo },
  });
  return ok(data, { requestId });
}
