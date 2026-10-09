/**
 * VOLTAR A COBRAR UMA MULTA ISENTADA (módulo clínica, migration 9002).
 *
 * POST {} — desfaz a isenção: a multa volta a `pendente` (a cobrar) e reaparece em "a receber".
 * De Administrador, Gerente e Recepção, como isentar (`lib/clinica/multas.ts`). O motivo da
 * isenção desfeita, quem desfez e quando ficam na auditoria (`clinica.multa_cobrada`), já que a
 * linha limpa os campos da isenção (o banco exige: isenta ⇔ motivo e data).
 *
 * ⚠️ CLIENT DE SERVIÇO, como em `isentar`: `clinica_multas` não tem policy de escrita para a
 * sessão. A organização vem do cookie validado e vai em todo filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDaMulta } from "@/lib/clinica/gestao-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "clinica_multas" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDaMulta(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Multa não encontrada.", 404, { requestId });
  }

  const admin = createAdminClient();
  const org = authz.org.orgId;
  const antes = await admin
    .from("clinica_multas")
    .select("isencao_motivo, isenta_por_user_id, isenta_em")
    .eq("organization_id", org)
    .eq("id", id)
    .eq("status", "isenta")
    .maybeSingle();
  if (antes.error) {
    if (moduloClinicaNaoInstalado(antes.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", antes.error.message, 500, { requestId });
  }
  if (!antes.data) {
    return fail("not_found", "Multa isenta não encontrada nesta clínica.", 404, { requestId });
  }

  const { data, error } = await admin
    .from("clinica_multas")
    .update({
      status: "pendente",
      isencao_motivo: null,
      isenta_por_user_id: null,
      isenta_em: null,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", org)
    .eq("id", id)
    .eq("status", "isenta")
    .select("id, status")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) {
    return fail("not_found", "Multa isenta não encontrada nesta clínica.", 404, { requestId });
  }

  await audit({
    action: "clinica.multa_cobrada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_multa",
    resourceId: id,
    requestId,
    metadata: {
      isencao_desfeita: {
        motivo: antes.data.isencao_motivo,
        por_user_id: antes.data.isenta_por_user_id,
        em: antes.data.isenta_em,
      },
    },
  });

  return ok(data, { requestId });
}
