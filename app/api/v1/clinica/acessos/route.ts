/**
 * TRILHA DE ACESSOS AO PRONTUÁRIO — quem abriu o prontuário de qual paciente, e quando.
 * Só o `admin` da clínica lê (RLS da migration 9001); ninguém edita nem apaga.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "prontuario_acessos" });
  if (!authz.ok) return authz.response;

  const contato = z.string().uuid().safeParse(new URL(req.url).searchParams.get("contact_id"));
  if (!contato.success) {
    return fail("validation_failed", "contact_id inválido", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prontuario_acessos")
    .select("id, user_id, acessado_em")
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", contato.data)
    .order("acessado_em", { ascending: false })
    .limit(200);

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(data ?? [], { requestId });
}
