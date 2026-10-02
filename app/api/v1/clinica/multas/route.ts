/**
 * MULTAS DE CANCELAMENTO EM CIMA DA HORA (módulo clínica, migration 9002).
 *
 * GET [?status=pendente|isenta|paga][&contact_id=uuid] → as multas da clínica, mais novas primeiro,
 * com a sessão e o paciente. Quem cria é o servidor, quando a sessão é cancelada
 * (`lib/clinica/regras-da-agenda.ts`); quem isenta é a recepção, com motivo. Leitura de
 * `agent`+ (9003): o perfil "Somente leitura" não vê valor financeiro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { multasQuerySchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "clinica_multas" });
  if (!authz.ok) return authz.response;

  const lido = multasQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "consulta inválida", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  let consulta = supabase
    .from("clinica_multas")
    .select(
      "id, appointment_id, contact_id, percentual, antecedencia_horas, valor_cents, currency, status, isencao_motivo, isenta_por_user_id, isenta_em, created_at, calendar_appointments(title, starts_at, owner_user_id), contacts(name, display_name, phone_number)",
    )
    .eq("organization_id", authz.org.orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (lido.data.status) consulta = consulta.eq("status", lido.data.status);
  if (lido.data.contact_id) consulta = consulta.eq("contact_id", lido.data.contact_id);

  const { data, error } = await consulta;
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(data ?? [], { requestId });
}
