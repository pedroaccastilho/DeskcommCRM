/**
 * PUT /api/v1/clinica/equipe/[user_id] — o administrador escolhe os PERFIS de alguém da equipe
 * (migration 9008), por exemplo Jurídico + Financeiro + Gerente, ou Gerente + Fisioterapeuta. Um gesto grava papel, menu e cadastro de profissional juntos
 * (`lib/clinica/equipe-servidor.ts`); para perfil de saúde, o registro do conselho vem no corpo
 * ou do cadastro que a pessoa já tinha no mesmo conselho.
 *
 * Só `admin`. A clínica nunca fica sem administrador.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { aplicarCargos } from "@/lib/clinica/equipe-servidor";
import { definirCargosSchema } from "@/lib/clinica/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ user_id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_equipe" });
  if (!authz.ok) return authz.response;

  const { user_id } = await ctx.params;
  if (!z.string().uuid().safeParse(user_id).success) {
    return fail("validation_failed", "Pessoa inválida.", 422, { requestId });
  }
  const lido = definirCargosSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const { cargos, ...registro } = lido.data;

  const resultado = await aplicarCargos(await createClient(), createAdminClient(), {
    orgId: authz.org.orgId,
    userId: user_id,
    cargos,
    registro,
    definidoPor: authz.user.id,
  });
  if (!resultado.ok) {
    return fail(resultado.code, resultado.message, resultado.status, { requestId });
  }

  await audit({
    action: "clinica.cargo_definido",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "membership",
    resourceId: user_id,
    requestId,
    metadata: { target_user_id: user_id, cargos, old_role: resultado.papelAntes },
  });

  return ok({ user_id, cargos }, { requestId });
}
