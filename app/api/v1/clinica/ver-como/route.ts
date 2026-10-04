/**
 * POST   /api/v1/clinica/ver-como — o administrador passa a ver o sistema como outra pessoa da
 *                                   equipe (`{ user_id }`), só para olhar.
 * DELETE /api/v1/clinica/ver-como — volta para o administrador.
 *
 * Regra e motivo em `lib/clinica/ver-como.ts`. Só `admin`, e só para quem está ativo na mesma
 * organização. Os dois gestos ficam na auditoria em nome do administrador.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { apagarVerComo, gravarVerComo, lerVerComo } from "@/lib/clinica/ver-como";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpo = z.object({ user_id: z.string().uuid() });

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // Trocar de uma pessoa para outra sem voltar antes também é permitido.
  const supportDenied = await requireSupportWrite(undefined, { permitirVerComo: true });
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_ver_como" });
  if (!authz.ok) return authz.response;
  if (authz.user.support) {
    return fail("forbidden", "No acompanhamento administrativo não dá para entrar como.", 403, {
      requestId,
    });
  }

  const lido = corpo.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Escolha uma pessoa da equipe.", 422, { requestId });
  }
  const { user_id } = lido.data;
  if (user_id === authz.user.id) {
    return fail("validation_failed", "Você já está vendo como você mesmo.", 422, { requestId });
  }

  const { data: vinculo, error } = await (await createClient())
    .from("user_organizations")
    .select("user_id, role, revoked_at, accepted_at")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!vinculo || vinculo.revoked_at || !vinculo.accepted_at) {
    return fail("not_found", "Essa pessoa não está ativa na equipe.", 404, { requestId });
  }

  await gravarVerComo({ orgId: authz.org.orgId, userId: user_id });
  await audit({
    action: "clinica.ver_como_iniciado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "membership",
    resourceId: user_id,
    requestId,
    metadata: { target_user_id: user_id, target_role: vinculo.role },
  });
  return ok({ user_id }, { requestId });
}

export async function DELETE(): Promise<Response> {
  const requestId = randomUUID();
  // Sair do modo é a única escrita que o próprio modo deixa passar.
  const supportDenied = await requireSupportWrite(undefined, { permitirVerComo: true });
  if (supportDenied) return supportDenied;

  const authz = await requireRole("viewer", { requestId, resource: "clinica_ver_como" });
  if (!authz.ok) return authz.response;

  const anterior = await lerVerComo();
  await apagarVerComo();
  if (anterior && anterior.orgId === authz.org.orgId) {
    await audit({
      action: "clinica.ver_como_encerrado",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "membership",
      resourceId: anterior.userId,
      requestId,
      metadata: { target_user_id: anterior.userId },
    });
  }
  return ok({ encerrado: true }, { requestId });
}
