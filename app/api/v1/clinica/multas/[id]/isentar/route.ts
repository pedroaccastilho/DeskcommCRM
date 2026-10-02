/**
 * ISENTAR UMA MULTA, COM MOTIVO (módulo clínica, migration 9002).
 *
 * POST { motivo } — a recepção (`agent`+) isenta quando há razão (atestado, imprevisto aceito).
 * Só multa `pendente`. O motivo, quem isentou e quando ficam na linha e na auditoria.
 *
 * ⚠️ CLIENT DE SERVIÇO: `clinica_multas` não tem policy de escrita para a sessão, de propósito
 * (ninguém fabrica nem apaga multa pela API do Supabase). A organização vem do cookie validado e
 * vai em todo filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { isentarMultaSchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "clinica_multas" });
  if (!authz.ok) return authz.response;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Multa não encontrada.", 404, { requestId });
  }
  const lido = isentarMultaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const org = authz.org.orgId;
  const { data, error } = await admin
    .from("clinica_multas")
    .update({
      status: "isenta",
      isencao_motivo: lido.data.motivo,
      isenta_por_user_id: authz.user.id,
      isenta_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org)
    .eq("id", id)
    .eq("status", "pendente")
    .select("id, status, isencao_motivo, isenta_em")
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Multa pendente não encontrada nesta clínica.", 404, { requestId });
  }

  await audit({
    action: "clinica.multa_isenta",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_multa",
    resourceId: id,
    requestId,
    metadata: { motivo: lido.data.motivo },
  });

  return ok(data, { requestId });
}
