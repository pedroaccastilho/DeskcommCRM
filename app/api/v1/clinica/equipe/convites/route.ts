/**
 * POST /api/v1/clinica/equipe/convites — cadastrar uma pessoa nova na equipe JÁ COM OS CARGOS
 * (migration 9008). O convite do núcleo (`emitirConvite`) leva o papel e o menu dos cargos; para
 * os perfis e o registro do conselho (com perfil de saúde) ficam em `clinica_convites_cargos` e
 * viram os perfis e o cadastro de profissional quando a pessoa aceita
 * (`lib/clinica/cargo-do-convite.ts`).
 *
 * Só `admin` (Pedro, 2026-10-04: só o administrador da clínica cadastra). Devolve o link de
 * aceite, para quando o e-mail não sai.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { interfaceDosCargos, papelDosCargos } from "@/lib/clinica/cargos";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { guardarCargosDoConvite } from "@/lib/clinica/equipe-servidor";
import { convidarComCargosSchema } from "@/lib/clinica/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { emitirConvite } from "@/lib/team/convites";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_equipe" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const lido = convidarComCargosSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const { email, cargos, nome_profissional, registro_numero, registro_uf } = lido.data;

  if (!isServiceRoleConfigured()) {
    return fail(
      "upstream_unavailable",
      "O cadastro de equipe precisa da chave de serviço configurada.",
      503,
      {
        requestId,
      },
    );
  }
  const admin = createAdminClient();

  // Já é da equipe? Trocar o cargo de quem já entrou é na própria linha, não por convite novo.
  const { data: membros } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", org.orgId)
    .is("revoked_at", null);
  for (const m of membros ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id as string);
    if (u?.user?.email?.trim().toLowerCase() === email) {
      return fail(
        "conflict",
        "Essa pessoa já faz parte da equipe. Troque os perfis na lista.",
        409,
        {
          requestId,
        },
      );
    }
  }

  // Confere o módulo antes de mandar e-mail: sem ele, os perfis não teriam onde ficar.
  const { error: moduloErro } = await admin
    .from("clinica_convites_cargos")
    .select("invite_id", { head: true, count: "exact" })
    .eq("organization_id", org.orgId);
  if (moduloErro) {
    if (moduloClinicaNaoInstalado(moduloErro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", moduloErro.message, 500, { requestId });
  }

  const emitido = await emitirConvite(admin, {
    email,
    role: papelDosCargos(cargos),
    interfaceSettings: interfaceDosCargos(cargos),
    organizationId: org.orgId,
    orgName: org.name,
    inviterId: user.id,
    inviterName: user.full_name ?? user.email ?? "Um colega",
    requestId,
  });

  const { error: guardarErro } = await guardarCargosDoConvite(admin, {
    inviteId: emitido.convite.id,
    orgId: org.orgId,
    cargos,
    registro: { nome_profissional, registro_numero, registro_uf },
    criadoPor: user.id,
  });
  if (guardarErro) return fail("internal_error", guardarErro.message, 500, { requestId });

  await audit({
    action: "clinica.convite_com_cargo",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "team_invite",
    resourceId: emitido.convite.id,
    requestId,
    metadata: { cargos, renovado: emitido.renovado },
  });

  return ok(
    {
      invite_id: emitido.convite.id,
      email,
      cargos,
      expires_at: emitido.convite.expires_at,
      email_dispatched: emitido.email_dispatched,
      email_error: emitido.email_error ?? null,
      accept_url: emitido.accept_url,
    },
    { status: 201, requestId },
  );
}
