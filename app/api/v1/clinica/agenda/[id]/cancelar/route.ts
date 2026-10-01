/**
 * CANCELAR UMA SESSÃO DIZENDO QUEM CANCELOU (módulo clínica, migration 9002).
 *
 * POST { motivo, pela_clinica?, revision? }
 *
 * É o mesmo cancelamento da agenda do núcleo (`cancelarAgendamentoHandler`), com uma informação a
 * mais: `pela_clinica: true` quando foi a clínica que desmarcou, e aí não há multa. O DELETE de
 * `/api/v1/agenda/agendamentos` e o agente de IA continuam cancelando como paciente, e a multa
 * do cancelamento em cima da hora sai igual (`lib/clinica/regras-da-agenda.ts`).
 *
 * A resposta traz `multa` (ou `null`) para a tela avisar na hora.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { cancelarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { cancelarSessaoSchema } from "@/lib/clinica/agenda-schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Sessão não encontrada.", 404, { requestId });
  }
  const lido = cancelarSessaoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  try {
    const resultado = await cancelarAgendamentoHandler(
      supabase,
      {
        organization_id: org,
        actor: { type: "user", id: authz.user.id, role: authz.org.role },
        requestId,
      },
      {
        id,
        reason: lido.data.motivo,
        cancelado_por: lido.data.pela_clinica ? "clinica" : "paciente",
        ...(lido.data.revision !== undefined ? { revision: lido.data.revision } : {}),
      },
    );

    const { data: multa } = await supabase
      .from("clinica_multas")
      .select("id, percentual, antecedencia_horas, valor_cents, currency, status")
      .eq("organization_id", org)
      .eq("appointment_id", id)
      .maybeSingle();

    return ok({ ...resultado, multa: multa ?? null }, { requestId });
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }
}
