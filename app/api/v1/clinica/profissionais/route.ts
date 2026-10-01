/**
 * PROFISSIONAIS DE SAÚDE DA CLÍNICA — quem pode ler e assinar o prontuário.
 *
 * GET: qualquer membro (a lista não é dado clínico). POST: só `admin` — a RLS da migration 9001
 * cobra o mesmo degrau; a rota repete por clareza de mensagem, não como segunda régua.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { criarProfissionalSchema } from "@/lib/clinica/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo, created_at";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_profissionais" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_profissionais")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .order("nome_profissional");

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_profissionais" });
  if (!authz.ok) return authz.response;

  const lido = criarProfissionalSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();

  // O profissional precisa ser membro ativo desta organização: a FK só confere que o usuário existe.
  const { data: membro } = await supabase
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", lido.data.user_id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!membro) {
    return fail("validation_failed", "Essa pessoa não faz parte da equipe desta clínica.", 422, {
      requestId,
    });
  }

  const { data, error } = await supabase
    .from("clinica_profissionais")
    .insert({ organization_id: authz.org.orgId, ...lido.data })
    .select(COLUNAS)
    .single();

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "23505") {
      return fail("conflict", "Essa pessoa já está cadastrada como profissional.", 409, {
        requestId,
      });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.profissional_cadastrado",
    resourceType: "clinica_profissional",
    resourceId: data.id,
    requestId,
    metadata: { user_id: data.user_id, conselho: data.conselho, modalidades: data.modalidades },
  });

  return ok(data, { requestId, status: 201 });
}
