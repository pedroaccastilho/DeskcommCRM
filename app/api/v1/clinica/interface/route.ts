/**
 * A INTERFACE NOVA COMO A PRINCIPAL DA EQUIPE (módulo clínica, migration 9010).
 *
 * GET (qualquer membro): `{ nova_principal }`. PUT (só `admin`): `{ nova_principal: boolean }`.
 * Ligada, quem não é Administrador e abre uma tela da interface atual com equivalente na nova é
 * levado para ela (`lib/novo/raiz.ts`). A escolha mora em `clinica_politicas`, a linha da
 * organização que só o Administrador grava (a RLS cobra o mesmo degrau).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({ nova_principal: z.boolean() }).strict();

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_interface" });
  if (!authz.ok) return authz.response;

  const { data, error } = await (
    await createClient()
  )
    .from("clinica_politicas")
    .select("interface_nova_principal")
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(
    {
      nova_principal:
        (data as { interface_nova_principal?: boolean } | null)?.interface_nova_principal === true,
    },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_interface" });
  if (!authz.ok) return authz.response;

  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "envie nova_principal: true ou false", 422, { requestId });
  }

  const { error } = await (await createClient()).from("clinica_politicas").upsert(
    {
      organization_id: authz.org.orgId,
      interface_nova_principal: lido.data.nova_principal,
      updated_by_user_id: authz.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.interface_principal_definida",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "clinica_politica",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { nova_principal: lido.data.nova_principal },
  });

  return ok({ nova_principal: lido.data.nova_principal }, { requestId });
}
