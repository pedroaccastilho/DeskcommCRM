/**
 * QUEM AINDA NÃO CONFIRMOU — a lista da recepção para ligar (módulo clínica, migration 9002).
 *
 * GET ?horas=48 → sessões da clínica que começam entre agora e daqui a N horas (padrão 48, teto
 * 168) e continuam `pending` (aguardando confirmação). Quem confirma pelo WhatsApp sai da lista
 * sozinho: o agente chama `crm_confirm_appointment`, que muda o compromisso para `confirmed`.
 *
 * "Sessão da clínica" = tipo com modalidade em `clinica_tipos_atendimento`.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  politicaDaLinha,
  sessaoDaGrade,
  type LinhaDoCompromisso,
  type Modalidade,
  type PoliticaDaAgenda,
} from "@/lib/clinica/agenda";
import { aConfirmarQuerySchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;

  const lido = aConfirmarQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "consulta inválida", 422, {
      requestId,
    });
  }
  const org = authz.org.orgId;
  const supabase = await createClient();

  const [etiquetas, politicaLida] = await Promise.all([
    supabase
      .from("clinica_tipos_atendimento")
      .select("event_type_id, modalidade, calendar_event_types(name, color)")
      .eq("organization_id", org),
    supabase
      .from("clinica_politicas")
      .select("antecedencia_cancelamento_horas, multa_cancelamento_pct, tolerancia_atraso_minutos")
      .eq("organization_id", org)
      .maybeSingle(),
  ]);
  const erro = etiquetas.error ?? politicaLida.error;
  if (erro) {
    if (moduloClinicaNaoInstalado(erro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erro.message, 500, { requestId });
  }

  type Etiqueta = {
    event_type_id: string;
    modalidade: Modalidade;
    calendar_event_types: { name: string; color: string | null } | null;
  };
  const lista = (etiquetas.data ?? []) as unknown as Etiqueta[];
  if (lista.length === 0) return ok([], { requestId });
  const tipos = new Map(
    lista.map((e) => [
      e.event_type_id,
      {
        nome: e.calendar_event_types?.name ?? "Atendimento",
        cor: e.calendar_event_types?.color ?? null,
        modalidade: e.modalidade,
      },
    ]),
  );
  const politica = politicaDaLinha(politicaLida.data as Partial<PoliticaDaAgenda> | null);

  const agora = new Date();
  const ate = new Date(agora.getTime() + lido.data.horas * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("calendar_appointments")
    .select(
      "id, title, starts_at, ends_at, status, owner_user_id, event_type_id, contact_id, contacts(name, display_name, phone_number)",
    )
    .eq("organization_id", org)
    .eq("status", "pending")
    .in("event_type_id", [...tipos.keys()])
    .gte("starts_at", agora.toISOString())
    .lte("starts_at", ate.toISOString())
    .order("starts_at")
    .limit(500);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(
    ((data ?? []) as unknown as LinhaDoCompromisso[]).map((l) => sessaoDaGrade(l, tipos, politica)),
    { requestId },
  );
}
