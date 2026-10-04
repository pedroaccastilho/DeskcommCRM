/**
 * MARCAR A ETAPA DO DIA DE UMA SESSÃO: "chegou" e "em atendimento" (módulo clínica, migration 9007).
 *
 * POST { etapa: "chegou" | "em_atendimento" | "desfazer" } — a recepção (`agent`+).
 *
 * - "chegou" grava a hora da chegada, se ainda não havia;
 * - "em_atendimento" grava a chegada (se faltava) e o início do atendimento, se ainda não havia;
 * - "desfazer" limpa as duas.
 * Marcar de novo o que já está marcado não muda nada e não audita (não houve efeito).
 *
 * Só sessão da clínica (o tipo tem modalidade em `clinica_tipos_atendimento`) e ainda em aberto
 * (aguardando confirmação ou confirmada). O status do núcleo NÃO muda: "realizado" e "não
 * compareceu" continuam sendo a agenda do núcleo.
 *
 * Devolve `{ data: { appointment_id, chegou_em, atendimento_iniciado_em } }`.
 *
 * O histórico da clínica (`clinica_agenda_historico`) não recebe a etapa: o CHECK de `acao` dele
 * não tem esses valores, e mudá-lo é outra decisão. A auditoria registra quem marcou e quando.
 *
 * ⚠️ CLIENT DE SERVIÇO: `clinica_sessao_etapas` não tem policy de escrita para a sessão, de
 * propósito. A organização vem do cookie validado (`requireRole`), nunca do corpo, e vai em todo
 * filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  proximaEtapa,
  STATUS_QUE_ACEITAM_ETAPA,
  type EtapaComAutoria,
} from "@/lib/clinica/agenda";
import { etapaDaSessaoSchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS_DA_ETAPA =
  "chegou_em, chegou_por_user_id, atendimento_iniciado_em, atendimento_iniciado_por_user_id";

/** Tabela do módulo ausente: 42P01 no Postgres, PGRST205 enquanto o PostgREST não recarregou. */
function tabelaAusente(error: { code?: string } | null): boolean {
  return moduloClinicaNaoInstalado(error) || error?.code === "PGRST205";
}

function mesmaEtapa(a: EtapaComAutoria | null, b: EtapaComAutoria): boolean {
  return (
    (a?.chegou_em ?? null) === b.chegou_em &&
    (a?.atendimento_iniciado_em ?? null) === b.atendimento_iniciado_em
  );
}

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
  const lido = etapaDaSessaoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const pedida = lido.data.etapa;

  const admin = createAdminClient();
  const org = authz.org.orgId;

  const sessao = await admin
    .from("calendar_appointments")
    .select("id, status, event_type_id")
    .eq("organization_id", org)
    .eq("id", id)
    .maybeSingle();
  if (sessao.error) return fail("internal_error", sessao.error.message, 500, { requestId });
  if (!sessao.data) {
    return fail("not_found", "Sessão não encontrada nesta clínica.", 404, { requestId });
  }

  const tipoDaSessao = sessao.data.event_type_id as string | null;
  const etiqueta = tipoDaSessao
    ? await admin
        .from("clinica_tipos_atendimento")
        .select("modalidade")
        .eq("organization_id", org)
        .eq("event_type_id", tipoDaSessao)
        .maybeSingle()
    : null;
  if (etiqueta?.error) {
    if (tabelaAusente(etiqueta.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", etiqueta.error.message, 500, { requestId });
  }
  if (!etiqueta?.data?.modalidade) {
    return fail(
      "invalid_state_transition",
      "Esta sessão não é da clínica: o tipo de agendamento dela não tem modalidade. Defina a " +
        "modalidade desse tipo nas configurações da clínica.",
      409,
      { requestId },
    );
  }

  const status = sessao.data.status as string;
  if (!(STATUS_QUE_ACEITAM_ETAPA as readonly string[]).includes(status)) {
    return fail(
      "invalid_state_transition",
      "Só dá para marcar chegada ou atendimento numa sessão aguardando confirmação ou " +
        "confirmada. Esta já foi realizada, cancelada ou marcada como falta.",
      409,
      { requestId, details: { status } },
    );
  }

  const atualLida = await admin
    .from("clinica_sessao_etapas")
    .select(COLUNAS_DA_ETAPA)
    .eq("organization_id", org)
    .eq("appointment_id", id)
    .maybeSingle();
  if (atualLida.error) {
    if (tabelaAusente(atualLida.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", atualLida.error.message, 500, { requestId });
  }
  const atual = (atualLida.data as EtapaComAutoria | null) ?? null;

  const agora = new Date().toISOString();
  const proxima = proximaEtapa(atual, pedida, agora, authz.user.id);

  if (mesmaEtapa(atual, proxima)) {
    return ok(
      {
        appointment_id: id,
        chegou_em: proxima.chegou_em,
        atendimento_iniciado_em: proxima.atendimento_iniciado_em,
      },
      { requestId },
    );
  }

  const gravada = await admin
    .from("clinica_sessao_etapas")
    .upsert(
      { organization_id: org, appointment_id: id, ...proxima, updated_at: agora },
      { onConflict: "organization_id,appointment_id" },
    )
    .select("appointment_id, chegou_em, atendimento_iniciado_em")
    .single();
  if (gravada.error) {
    if (tabelaAusente(gravada.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", gravada.error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.sessao_etapa_marcada",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "calendar_appointment",
    resourceId: id,
    requestId,
    metadata: {
      etapa: pedida,
      chegou_em: gravada.data.chegou_em,
      atendimento_iniciado_em: gravada.data.atendimento_iniciado_em,
    },
  });

  return ok(
    {
      appointment_id: id,
      chegou_em: (gravada.data.chegou_em as string | null) ?? null,
      atendimento_iniciado_em: (gravada.data.atendimento_iniciado_em as string | null) ?? null,
    },
    { requestId },
  );
}
