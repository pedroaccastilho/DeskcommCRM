/**
 * A AGENDA DA CLÍNICA PENDURADA NO HANDLER DA AGENDA DO NÚCLEO (módulo clínica, migration 9002).
 *
 * Quem chama é `lib/agenda/regras-de-modulo.ts`, dentro de `alterarAgendamentoHandler` e
 * `cancelarAgendamentoHandler`. Por isso a mesma regra vale para a tela e para o agente de IA,
 * que chamam o mesmo handler.
 *
 * ⚠️ SÓ SESSÃO DA CLÍNICA. A regra vale para o compromisso cujo tipo tem modalidade em
 * `clinica_tipos_atendimento`. O módulo é instalado na INSTALAÇÃO, e outra organização da mesma
 * VPS que não é clínica não pode passar a pagar multa por cancelar uma reunião.
 *
 * ⚠️ MÓDULO NÃO INSTALADO É NO-OP. As tabelas não existem (42P01) e nada acontece.
 *
 * ⚠️ O QUE ACONTECE DEPOIS DA GRAVAÇÃO NÃO DESFAZ A GRAVAÇÃO. Histórico e multa falham para o
 * log, nunca para quem cancelou: a sessão já está cancelada no banco. A única recusa daqui é a
 * de ANTES (falta dentro da tolerância), e ela é regra de negócio com código próprio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  acaoDoHistorico,
  faltaLiberadaEm,
  multaDoCancelamento,
  politicaDaLinha,
  type Modalidade,
  type PoliticaDaAgenda,
  type QuemCancelou,
} from "./agenda";
import { moduloClinicaNaoInstalado } from "./api";

type SB = SupabaseClient;

export interface TipoDaClinica {
  modalidade: Modalidade;
  valor_cents: number | null;
  currency: string;
}

/** A etiqueta de modalidade do tipo, ou `null` (tipo sem modalidade, ou módulo não instalado). */
export async function tipoDaClinica(
  db: SB,
  organizationId: string,
  eventTypeId: string | null,
): Promise<TipoDaClinica | null> {
  if (!eventTypeId) return null;
  const { data, error } = await db
    .from("clinica_tipos_atendimento")
    .select("modalidade, valor_cents, currency")
    .eq("organization_id", organizationId)
    .eq("event_type_id", eventTypeId)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) return null;
    throw error;
  }
  return (data as TipoDaClinica | null) ?? null;
}

/** A política gravada, ou a padrão. */
export async function politicaDaOrganizacao(
  db: SB,
  organizationId: string,
): Promise<PoliticaDaAgenda> {
  const { data, error } = await db
    .from("clinica_politicas")
    .select("antecedencia_cancelamento_horas, multa_cancelamento_pct, tolerancia_atraso_minutos")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error && !moduloClinicaNaoInstalado(error)) throw error;
  return politicaDaLinha(data as Partial<PoliticaDaAgenda> | null);
}

function especieDoAutor(actor: Actor): "user" | "ai" | "system" {
  if (actor.type === "user") return "user";
  if (actor.type === "ai_agent") return "ai";
  return "system";
}

const FORMATO_DA_HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * ANTES de registrar o desfecho: "não compareceu" só depois da tolerância de atraso.
 *
 * Marcar falta cedo demais devolve o horário à grade (`no_show` libera o horário) com o paciente
 * ainda a caminho, e aplica a perda da sessão a quem estava dentro da tolerância.
 */
export async function antesDoDesfechoNaClinica(
  db: SB,
  ctx: HandlerCtx,
  compromisso: { eventTypeId: string | null; inicio: Date; status: string },
  agora: Date = new Date(),
): Promise<void> {
  if (compromisso.status !== "no_show") return;
  const tipo = await tipoDaClinica(db, ctx.organization_id, compromisso.eventTypeId);
  if (!tipo) return;
  const politica = await politicaDaOrganizacao(db, ctx.organization_id);
  const liberada = faltaLiberadaEm(compromisso.inicio, politica);
  if (agora.getTime() < liberada.getTime()) {
    throw new ApiError(
      422,
      "clinica_dentro_da_tolerancia",
      { falta_liberada_em: liberada.toISOString() },
      ctx.requestId,
      `O paciente ainda está dentro da tolerância de ${politica.tolerancia_atraso_minutos} minutos. ` +
        `A falta pode ser registrada a partir das ${FORMATO_DA_HORA.format(liberada)}.`,
    );
  }
}

export interface MudancaNaAgenda {
  appointmentId: string;
  eventTypeId: string | null;
  contactId: string | null;
  /** A transição da agenda do núcleo (`rescheduled`, `cancelled`, `no_show`…). */
  transicao: string;
  /** O início ANTES da mudança. */
  deInicio: Date;
  /** O início DEPOIS da mudança (igual ao de antes, quando não foi remarcação). */
  paraInicio: Date;
  motivo?: string | null;
  quemCancelou?: QuemCancelou;
}

/**
 * DEPOIS da gravação: histórico da sessão e, no cancelamento em cima da hora, a multa.
 *
 * Escreve com o client de serviço (as duas tabelas não têm policy de escrita para a sessão), e
 * por isso todo insert leva a organização do contexto autenticado, nunca do corpo.
 */
export async function depoisDaMudancaNaClinica(
  db: SB,
  ctx: HandlerCtx,
  mudanca: MudancaNaAgenda,
  agora: Date = new Date(),
): Promise<void> {
  const acao = acaoDoHistorico(mudanca.transicao);
  if (!acao) return;
  try {
    const tipo = await tipoDaClinica(db, ctx.organization_id, mudanca.eventTypeId);
    if (!tipo) return;

    const admin = createAdminClient();
    const porUserId = ctx.actor.type === "user" ? ctx.actor.id : null;
    const historico = await admin.from("clinica_agenda_historico").insert({
      organization_id: ctx.organization_id,
      appointment_id: mudanca.appointmentId,
      acao,
      de_inicio: mudanca.deInicio.toISOString(),
      para_inicio: mudanca.paraInicio.toISOString(),
      motivo: mudanca.motivo ?? null,
      por_tipo: especieDoAutor(ctx.actor),
      por_user_id: porUserId,
    });
    if (historico.error) throw historico.error;

    if (acao !== "cancelado" || !mudanca.contactId) return;

    const politica = await politicaDaOrganizacao(db, ctx.organization_id);
    const multa = multaDoCancelamento({
      inicio: mudanca.deInicio,
      canceladoEm: agora,
      politica,
      valorDaSessaoCents: tipo.valor_cents,
      quemCancelou: mudanca.quemCancelou ?? "paciente",
    });
    if (!multa) return;

    const { data, error } = await admin
      .from("clinica_multas")
      .insert({
        organization_id: ctx.organization_id,
        appointment_id: mudanca.appointmentId,
        contact_id: mudanca.contactId,
        percentual: multa.percentual,
        antecedencia_horas: multa.antecedencia_horas,
        valor_cents: multa.valor_cents,
        currency: tipo.currency,
      })
      .select("id")
      .single();
    if (error) {
      // Cancelar de novo (ou duas abas) não cria segunda multa.
      if (error.code === "23505") return;
      throw error;
    }

    await audit({
      action: "clinica.multa_registrada",
      actorUserId: porUserId,
      organizationId: ctx.organization_id,
      resourceType: "clinica_multa",
      resourceId: data.id,
      requestId: ctx.requestId,
      metadata: {
        appointment_id: mudanca.appointmentId,
        percentual: multa.percentual,
        antecedencia_horas: multa.antecedencia_horas,
        valor_cents: multa.valor_cents,
      },
    });
  } catch (err) {
    logger.error("[clinica] histórico ou multa da agenda não gravados", {
      organization_id: ctx.organization_id,
      appointment_id: mudanca.appointmentId,
      transicao: mudanca.transicao,
      error: err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err),
    });
  }
}
