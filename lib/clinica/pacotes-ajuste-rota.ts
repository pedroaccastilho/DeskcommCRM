/**
 * O CORPO COMUM DAS ROTAS QUE AJUSTAM UM PACOTE: congelar, prorrogar e cancelar (migration 9004).
 *
 * ⚠️ A GUARDA DE SUPORTE fica na ROTA (`requireSupportWrite()` antes de chamar isto): é lá que
 * o gate `tests/unit/suporte-cobertura-de-efeitos.test.ts` a procura.
 *
 * As três têm o mesmo desenho: papel, corpo validado, a função do banco que
 * faz a mudança e o evento na mesma transação (`fn_clinica_ajustar_pacote`), auditoria e o
 * pacote relido com saldo. Só o que muda é o papel, o corpo e o que vai para o banco.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import type { AuditAction } from "@/lib/audit/actions";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "./api";
import {
  COLUNAS_DO_PACOTE,
  pacoteComSaldo,
  recusaDoAjuste,
  regrasDaOrganizacao,
  type LinhaDoPacote,
} from "./pacotes-servidor";

type SB = ReturnType<typeof createAdminClient>;

export interface AjusteDoPacote<C> {
  tipo: "congelamento" | "prorrogacao" | "cancelamento";
  papel: Role;
  schema: z.ZodType<C>;
  acao: AuditAction;
  /** O que vai para o banco. Pode ler o pacote antes (o cancelamento calcula o reembolso). */
  preparar: (
    corpo: C,
    pacote: LinhaDoPacote,
    admin: SB,
    org: string,
  ) => Promise<{ dias: number | null; motivo: string; valorCents: number | null }>;
}

export async function ajustarPacoteNaRota<C>(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
  ajuste: AjusteDoPacote<C>,
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole(ajuste.papel, { requestId, resource: "clinica_pacotes" });
  if (!authz.ok) return authz.response;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Pacote não encontrado nesta clínica.", 404, { requestId });
  }
  const lido = ajuste.schema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const org = authz.org.orgId;

  const antes = await admin
    .from("clinica_pacotes")
    .select(COLUNAS_DO_PACOTE)
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (antes.error) {
    if (moduloClinicaNaoInstalado(antes.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", antes.error.message, 500, { requestId });
  }
  if (!antes.data) {
    return fail("not_found", "Pacote não encontrado nesta clínica.", 404, { requestId });
  }

  const pedido = await ajuste.preparar(lido.data, antes.data as unknown as LinhaDoPacote, admin, org);
  const { error } = await admin.rpc("fn_clinica_ajustar_pacote", {
    p_org: org,
    p_pacote: id,
    p_tipo: ajuste.tipo,
    p_dias: pedido.dias,
    p_motivo: pedido.motivo,
    p_valor_cents: pedido.valorCents,
    p_user: authz.user.id,
  });
  if (error) {
    const recusa = recusaDoAjuste(error);
    if (recusa) return fail(recusa.code, recusa.mensagem, recusa.status, { requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }

  const depois = await admin
    .from("clinica_pacotes")
    .select(COLUNAS_DO_PACOTE)
    .eq("organization_id", org)
    .eq("id", id)
    .single();
  if (depois.error) return fail("internal_error", depois.error.message, 500, { requestId });
  const regras = await regrasDaOrganizacao(admin, org);
  const pacote = pacoteComSaldo(
    depois.data as unknown as LinhaDoPacote,
    regras.sessoes_restantes_aviso_renovacao,
  );

  await audit({
    action: ajuste.acao,
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_pacote",
    resourceId: id,
    requestId,
    metadata: {
      contact_id: pacote.contact_id,
      dias: pedido.dias,
      motivo: pedido.motivo,
      valor_cents: pedido.valorCents,
      valido_ate: pacote.valido_ate,
      saldo: pacote.saldo,
    },
  });
  return ok(pacote, { requestId });
}
