/**
 * A LISTA DE ORIGENS DE PACIENTE DA CLÍNICA (módulo clínica, migration 9005).
 *
 * GET  → as origens, na ordem da lista. Todo membro lê (a ficha e o cadastro mostram). Na
 *        primeira leitura, a clínica ganha a lista padrão (`ORIGENS_PADRAO`).
 * POST { nome, tipo, ativo?, ordem? } → acrescenta uma origem. Só o administrador. O tipo diz o
 *        que a recepção conta: Instagram e encaminhamento pedem o detalhe, indicação pede quem
 *        indicou.
 *
 * Escrita pelo CLIENT DE SESSÃO: a RLS de `clinica_origens` só deixa o administrador.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { origemSchema } from "@/lib/clinica/origens-schemas";
import {
  COLUNAS_DA_ORIGEM,
  ModuloClinicaAusente,
  origensDaClinica,
} from "@/lib/clinica/origens-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_origens" });
  if (!authz.ok) return authz.response;

  try {
    const origens = await origensDaClinica(
      await createClient(),
      createAdminClient(),
      authz.org.orgId,
    );
    return ok(origens, { requestId });
  } catch (err) {
    if (err instanceof ModuloClinicaAusente) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_origens" });
  if (!authz.ok) return authz.response;

  const lido = origemSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const { data, error } = await supabase
    .from("clinica_origens")
    .insert({ organization_id: org, ...lido.data })
    .select(COLUNAS_DA_ORIGEM)
    .single();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "23505") {
      return fail("conflict", "Já existe uma origem com esse nome.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.origem_cadastrada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_origem",
    resourceId: data.id,
    requestId,
    metadata: { nome: data.nome, tipo: data.tipo },
  });
  return ok(data, { requestId, status: 201 });
}
