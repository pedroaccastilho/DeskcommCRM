/**
 * CANCELAR UMA SESSÃO DIZENDO QUEM CANCELOU (módulo clínica, migration 9002).
 *
 * POST { motivo, pela_clinica?, multa?: "cobrar" | "isentar", motivo_isencao?, revision? }
 *
 * É o mesmo cancelamento da agenda do núcleo (`cancelarAgendamentoHandler`), com uma informação a
 * mais: `pela_clinica: true` quando foi a clínica que desmarcou, e aí não há multa. O DELETE de
 * `/api/v1/agenda/agendamentos` e o agente de IA continuam cancelando como paciente, e a multa
 * do cancelamento em cima da hora sai igual (`lib/clinica/regras-da-agenda.ts`).
 *
 * `multa: "isentar"` é a recepção já dizendo, ao cancelar, que o paciente não paga a multa que o
 * cancelamento gerar (Administrador, Gerente e Recepção, `lib/clinica/multas.ts`; quem não pode
 * é recusado ANTES de cancelar). A isenção sai igual à de `POST /multas/{id}/isentar`: motivo
 * (ou o padrão), quem e quando, na linha e na auditoria.
 *
 * A resposta traz `multa` (ou `null`) para a tela avisar na hora.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { cancelarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { cancelarSessaoSchema } from "@/lib/clinica/agenda-schemas";
import { recusaDaMulta } from "@/lib/clinica/gestao-servidor";
import { motivoDaIsencao } from "@/lib/clinica/multas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const isentar = lido.data.multa === "isentar" && !lido.data.pela_clinica;
  if (isentar) {
    const recusa = await recusaDaMulta(authz.org.orgId, authz.user.id, authz.org.role, requestId);
    if (recusa) return recusa;
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
        idioma: authz.user.idioma,
      },
      {
        id,
        reason: lido.data.motivo,
        cancelado_por: lido.data.pela_clinica ? "clinica" : "paciente",
        ...(lido.data.revision !== undefined ? { revision: lido.data.revision } : {}),
      },
    );

    let { data: multa } = await supabase
      .from("clinica_multas")
      .select("id, percentual, antecedencia_horas, valor_cents, currency, status")
      .eq("organization_id", org)
      .eq("appointment_id", id)
      .maybeSingle();

    if (isentar && multa?.status === "pendente") {
      // ⚠️ CLIENT DE SERVIÇO, como na rota de isentar: `clinica_multas` não tem policy de escrita
      // para a sessão. A organização vem do cookie validado e vai no filtro.
      const motivo = motivoDaIsencao(lido.data.motivo_isencao);
      const { data: isenta } = await createAdminClient()
        .from("clinica_multas")
        .update({
          status: "isenta",
          isencao_motivo: motivo,
          isenta_por_user_id: authz.user.id,
          isenta_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", org)
        .eq("id", multa.id)
        .eq("status", "pendente")
        .select("id, percentual, antecedencia_horas, valor_cents, currency, status")
        .maybeSingle();
      if (isenta) {
        multa = isenta;
        await audit({
          action: "clinica.multa_isenta",
          actorUserId: authz.user.id,
          organizationId: org,
          resourceType: "clinica_multa",
          resourceId: isenta.id,
          requestId,
          metadata: { motivo, ao_cancelar: true },
        });
      }
    }

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
