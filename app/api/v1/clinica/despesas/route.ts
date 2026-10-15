/**
 * AS SAÍDAS DO CAIXA DA CLÍNICA (módulo clínica, migration 9012).
 *
 * POST { descricao, categoria, forma, valor_cents, dia } → registra uma despesa (aluguel,
 * salário, material…) que já saiu do caixa naquele dia. Registro à mão, sem banco. De
 * Administrador, Gerente e Financeiro (`recusaDoRelatorio`), auditado como
 * `clinica.despesa_registrada`. A lista é lida pelo painel (`GET /api/v1/clinica/financeiro`).
 *
 * ⚠️ CLIENT DE SERVIÇO na escrita: `clinica_despesas` não tem policy de escrita para a sessão. A
 * organização vem do cookie validado, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { diaParaInstante, registrarDespesaSchema } from "@/lib/clinica/financeiro";
import { recusaDoRelatorio } from "@/lib/clinica/gestao-servidor";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS = "id, descricao, categoria, forma, valor_cents, currency, pago_em";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "clinica_despesas" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoRelatorio(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const lido = registrarDespesaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const corpo = lido.data;
  const org = authz.org.orgId;
  const admin = createAdminClient();

  const { data: despesa, error } = await admin
    .from("clinica_despesas")
    .insert({
      organization_id: org,
      descricao: corpo.descricao,
      categoria: corpo.categoria,
      forma: corpo.forma,
      valor_cents: corpo.valor_cents,
      currency: await moedaDaOrganizacao(admin, org),
      pago_em: diaParaInstante(corpo.dia),
      registrado_por_user_id: authz.user.id,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.despesa_registrada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_despesa",
    resourceId: despesa.id,
    requestId,
    metadata: {
      descricao: corpo.descricao,
      categoria: corpo.categoria,
      forma: corpo.forma,
      valor_cents: corpo.valor_cents,
      dia: corpo.dia,
    },
  });

  return ok(despesa, { requestId, status: 201 });
}
