/**
 * APAGAR UMA SAÍDA DO CAIXA (módulo clínica, migration 9012).
 *
 * DELETE → apaga a despesa lançada por engano (valor ou dia errado). De Administrador, Gerente e
 * Financeiro, como registrar. O que foi apagado fica na auditoria (`clinica.despesa_apagada`).
 *
 * ⚠️ CLIENT DE SERVIÇO: `clinica_despesas` não tem policy de escrita para a sessão. A organização
 * vem do cookie validado e vai em todo filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDoRelatorio } from "@/lib/clinica/gestao-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "clinica_despesas" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoRelatorio(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Despesa não encontrada.", 404, { requestId });
  }

  const org = authz.org.orgId;
  const { data, error } = await createAdminClient()
    .from("clinica_despesas")
    .delete()
    .eq("organization_id", org)
    .eq("id", id)
    .select(
      "id, descricao, categoria, forma, valor_cents, currency, pago_em, registrado_por_user_id",
    )
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Despesa não encontrada nesta clínica.", 404, { requestId });
  }

  await audit({
    action: "clinica.despesa_apagada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_despesa",
    resourceId: id,
    requestId,
    metadata: { apagada: data },
  });

  return ok({ id }, { requestId });
}
