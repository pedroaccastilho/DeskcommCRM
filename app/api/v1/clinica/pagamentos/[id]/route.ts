/**
 * DESFAZER UM PAGAMENTO REGISTRADO (módulo clínica, migration 9011).
 *
 * DELETE → apaga o registro (marcado por engano, forma errada): a coisa volta a "a pagar", e a
 * multa paga volta a `pendente`. De Administrador, Gerente, Recepção e Financeiro, como registrar.
 * O que foi desfeito (forma, valor, quando, quem tinha registrado) fica na auditoria
 * (`clinica.pagamento_desfeito`).
 *
 * ⚠️ CLIENT DE SERVIÇO: `clinica_pagamentos` não tem policy de escrita para a sessão. A
 * organização vem do cookie validado e vai em todo filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDoPagamento } from "@/lib/clinica/gestao-servidor";
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

  const authz = await requireRole("agent", { requestId, resource: "clinica_pagamentos" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoPagamento(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Pagamento não encontrado.", 404, { requestId });
  }

  const admin = createAdminClient();
  const org = authz.org.orgId;
  const { data, error } = await admin
    .from("clinica_pagamentos")
    .delete()
    .eq("organization_id", org)
    .eq("id", id)
    .select(
      "id, contact_id, pacote_id, appointment_id, multa_id, forma, valor_cents, pago_em, registrado_por_user_id",
    )
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  if (!data) {
    return fail("not_found", "Pagamento não encontrado nesta clínica.", 404, { requestId });
  }

  if (data.multa_id) {
    const volta = await admin
      .from("clinica_multas")
      .update({ status: "pendente", updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("id", data.multa_id)
      .eq("status", "paga");
    if (volta.error) return fail("internal_error", volta.error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.pagamento_desfeito",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_pagamento",
    resourceId: id,
    requestId,
    metadata: { desfeito: data },
  });

  return ok({ id }, { requestId });
}
