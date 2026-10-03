/**
 * O RETORNO DE REAVALIAÇÃO JÁ MARCADO — o lado do servidor do plano de tratamento (migration 9006).
 *
 * Regra do Pedro (01/10/2026): o avaliador define a data da reavaliação na própria avaliação, e
 * ao assinar o retorno já fica agendado nessa data com ele. Sem horário livre no dia, o sistema
 * reserva o mais próximo e avisa a recepção. O paciente recebe a confirmação pelo WhatsApp.
 *
 * Quem chama é a rota do prontuário, logo depois de a avaliação ser gravada; o gatilho do banco já
 * criou o plano com `retorno_situacao = 'a_marcar'`. Este módulo:
 *
 * 1. escolhe o tipo de agendamento do retorno entre os tipos da modalidade
 *    (`clinica_tipos_atendimento`);
 * 2. pergunta os horários livres do avaliador pela MESMA coleta que a tela e a IA usam
 *    (`horariosLivresDaOrg`) e escolhe o do dia pedido ou o mais próximo depois;
 * 3. marca pelo MESMO handler da agenda (`marcarAgendamentoHandler`), com o avaliador como quem
 *    marca e como dono: a régua de horário livre e de sobreposição é a de sempre;
 * 4. grava o desfecho no plano, avisa o paciente e, quando algo não saiu como pedido, abre uma
 *    tarefa sem responsável para a recepção (a lista de Tarefas é onde a recepção trabalha).
 *
 * ⚠️ NUNCA LANÇA. A avaliação já está assinada: falhar aqui não pode virar erro para quem assinou.
 * O desfecho volta para a tela dizer o que aconteceu.
 *
 * ⚠️ SERVICE ROLE COM A ORGANIZAÇÃO DE QUEM ASSINOU. `organizationId` vem do `requireRole` da
 * rota, nunca do corpo, e vai em toda consulta. O plano só é tocado se for da avaliação que
 * acabou de ser assinada por quem está logado (`avaliacao_id` + `avaliador_user_id`).
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { marcarAgendamentoHandler } from "@/app/api/v1/agenda/agendamentos/_handler";
import { horariosLivresDaOrg } from "@/lib/agenda/consulta";
import { diaLocalISO } from "@/lib/agenda/fuso";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { interpolarTitulo } from "@/lib/tarefas/criar-tarefa";

import { avisarPacienteDoRetorno } from "./aviso-do-retorno";
import {
  DIAS_DE_PROCURA_DO_RETORNO,
  horarioDoRetorno,
  tipoDoRetorno,
  type SituacaoDoRetorno,
} from "./plano-de-tratamento";

const DIA_MS = 86_400_000;

export type DesfechoDoRetorno = {
  situacao: SituacaoDoRetorno;
  /** ISO-8601 do retorno marcado. */
  inicio: string | null;
  fuso: string | null;
  aviso: "enviado" | "nao_deu" | null;
};

type PlanoParaMarcar = {
  id: string;
  contact_id: string;
  modalidade: string;
  avaliador_user_id: string | null;
  avaliador_nome: string;
  reavaliacao_em: string | null;
  retorno_situacao: string;
};

export async function marcarRetornoDaAvaliacao(
  admin: SupabaseClient,
  args: {
    organizationId: string;
    avaliacaoId: string;
    /** Quem assinou: é o avaliador, dono do retorno e quem marca. */
    userId: string;
    requestId: string;
    agora?: Date;
  },
): Promise<DesfechoDoRetorno | null> {
  const org = args.organizationId;
  try {
    const { data: plano, error } = await admin
      .from("clinica_planos_tratamento")
      .select(
        "id, contact_id, modalidade, avaliador_user_id, avaliador_nome, reavaliacao_em, retorno_situacao",
      )
      .eq("organization_id", org)
      .eq("avaliacao_id", args.avaliacaoId)
      .maybeSingle<PlanoParaMarcar>();
    if (error) throw new Error(error.message);
    if (!plano || plano.retorno_situacao !== "a_marcar" || !plano.reavaliacao_em) return null;
    if (plano.avaliador_user_id !== args.userId) return null;

    const desfecho = await procurarEMarcar(admin, org, plano, args);

    let aviso: DesfechoDoRetorno["aviso"] = null;
    if (desfecho.appointmentId && desfecho.inicio && desfecho.fuso) {
      const r = await avisarPacienteDoRetorno(admin, {
        organizationId: org,
        contactId: plano.contact_id,
        appointmentId: desfecho.appointmentId,
        profissional: plano.avaliador_nome,
        quando: new Date(desfecho.inicio),
        fuso: desfecho.fuso,
      });
      aviso = r.enviado ? "enviado" : "nao_deu";
    }

    await admin
      .from("clinica_planos_tratamento")
      .update({
        retorno_situacao: desfecho.situacao,
        retorno_appointment_id: desfecho.appointmentId,
        retorno_aviso: aviso ?? "nao_enviado",
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", org)
      .eq("id", plano.id);

    await audit({
      action: "clinica.retorno_marcado",
      actorUserId: args.userId,
      organizationId: org,
      resourceType: "clinica_plano_tratamento",
      resourceId: plano.id,
      requestId: args.requestId,
      metadata: {
        situacao: desfecho.situacao,
        appointment_id: desfecho.appointmentId,
        pedido_para: plano.reavaliacao_em,
        aviso_ao_paciente: aviso,
      },
    });

    const tarefa = tituloDaTarefa(desfecho.situacao, aviso);
    if (tarefa) {
      await tarefaParaARecepcao(admin, {
        organizationId: org,
        contactId: plano.contact_id,
        titulo: tarefa,
        descricao: descricaoDaTarefa(plano, desfecho),
        requestId: args.requestId,
      });
    }

    return { situacao: desfecho.situacao, inicio: desfecho.inicio, fuso: desfecho.fuso, aviso };
  } catch (err) {
    logger.error("clinica_retorno_nao_marcado", {
      requestId: args.requestId,
      avaliacaoId: args.avaliacaoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function procurarEMarcar(
  admin: SupabaseClient,
  org: string,
  plano: PlanoParaMarcar,
  args: { userId: string; requestId: string; agora?: Date },
): Promise<{
  situacao: SituacaoDoRetorno;
  appointmentId: string | null;
  inicio: string | null;
  fuso: string | null;
}> {
  const nada = { appointmentId: null, inicio: null, fuso: null };

  const { data: tipos } = await admin
    .from("clinica_tipos_atendimento")
    .select("event_type_id, calendar_event_types!inner(id, name, is_active)")
    .eq("organization_id", org)
    .eq("modalidade", plano.modalidade);
  const candidatos = (
    (tipos ?? []) as unknown as Array<{
      event_type_id: string;
      calendar_event_types:
        { name: string; is_active: boolean } | { name: string; is_active: boolean }[];
    }>
  ).map((l) => {
    const t = Array.isArray(l.calendar_event_types)
      ? l.calendar_event_types[0]
      : l.calendar_event_types;
    return { id: l.event_type_id, nome: t?.name ?? "", ativo: Boolean(t?.is_active) };
  });
  const tipo = tipoDoRetorno(candidatos);
  if (!tipo) return { situacao: "sem_tipo", ...nada };

  const agora = args.agora ?? new Date();
  const diaPedido = plano.reavaliacao_em!;
  const inicioDoDia = new Date(`${diaPedido}T00:00:00Z`);
  const de = new Date(Math.max(agora.getTime(), inicioDoDia.getTime() - DIA_MS));
  const ate = new Date(inicioDoDia.getTime() + (DIAS_DE_PROCURA_DO_RETORNO + 1) * DIA_MS);
  if (ate.getTime() <= de.getTime()) return { situacao: "sem_horario", ...nada };

  const consulta = await horariosLivresDaOrg(admin, org, {
    eventTypeId: tipo.id,
    ownerUserId: args.userId,
    de,
    ate,
    agora,
  });
  if (!consulta.ok) return { situacao: "sem_horario", ...nada };

  const escolha = horarioDoRetorno(consulta.slots, diaPedido, (i) =>
    diaLocalISO(i, consulta.fusoDaRegra),
  );
  if (!escolha) return { situacao: "sem_horario", ...nada };

  let criado: Record<string, unknown>;
  try {
    criado = await marcarAgendamentoHandler(
      admin,
      {
        organization_id: org,
        actor: { type: "user", id: args.userId },
        requestId: args.requestId,
        // Uma avaliação, um retorno: assinar de novo (ou repetir a chamada) não marca outro.
        idempotencyKey: `clinica-retorno:${plano.id}`,
      },
      {
        event_type_id: tipo.id,
        starts_at: escolha.inicio.toISOString(),
        owner_user_id: args.userId,
        contact_id: plano.contact_id,
      },
    );
  } catch (err) {
    // O handler recusou (horário tomado entre a leitura e a escrita, tipo sem responsável…):
    // a recepção marca à mão, com a tarefa.
    logger.warn("clinica_retorno_recusado_pela_agenda", {
      requestId: args.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { situacao: "sem_horario", ...nada };
  }

  return {
    situacao: escolha.noDiaPedido ? "marcado" : "marcado_outro_dia",
    appointmentId: String(criado.id),
    inicio: String(criado.starts_at),
    fuso: String(criado.time_zone ?? consulta.fusoDaRegra),
  };
}

/** O título da tarefa da recepção, quando há o que fazer. Puro e exportado para o teste. */
export function tituloDaTarefa(
  situacao: SituacaoDoRetorno,
  aviso: DesfechoDoRetorno["aviso"],
): string | null {
  if (situacao === "sem_tipo" || situacao === "sem_horario") {
    return "Marcar o retorno de reavaliação de {{contact.name}}";
  }
  if (situacao === "marcado_outro_dia") {
    return "Avisar {{contact.name}}: o retorno ficou em outro dia";
  }
  if (situacao === "marcado" && aviso === "nao_deu") {
    return "Avisar {{contact.name}} do retorno de reavaliação";
  }
  return null;
}

function descricaoDaTarefa(
  plano: PlanoParaMarcar,
  desfecho: { situacao: SituacaoDoRetorno; inicio: string | null },
): string {
  const pedido = plano.reavaliacao_em!.split("-").reverse().join("/");
  const base = `${plano.avaliador_nome} pediu a reavaliação para ${pedido}.`;
  if (desfecho.situacao === "sem_tipo") {
    return `${base} Não há tipo de agendamento ligado a esta modalidade em Configurações › Clínica.`;
  }
  if (desfecho.situacao === "sem_horario") {
    return `${base} A agenda de ${plano.avaliador_nome} não tinha horário livre perto dessa data.`;
  }
  if (desfecho.situacao === "marcado_outro_dia") {
    return `${base} O dia estava cheio e o sistema reservou o horário livre mais próximo. Confira na agenda e confirme com o paciente.`;
  }
  return `${base} O retorno está na agenda, mas a confirmação pelo WhatsApp não saiu.`;
}

/**
 * A tarefa sem responsável: a recepção é um grupo, não uma pessoa, e a lista de Tarefas mostra
 * as sem responsável para todos. O título usa o nome do paciente como o resto do produto
 * (`interpolarTitulo`), e a tarefa vence hoje.
 */
async function tarefaParaARecepcao(
  admin: SupabaseClient,
  args: {
    organizationId: string;
    contactId: string;
    titulo: string;
    descricao: string;
    requestId: string;
  },
): Promise<void> {
  const { data: contato } = await admin
    .from("contacts")
    .select("id, name, display_name")
    .eq("id", args.contactId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  const titulo = interpolarTitulo(args.titulo, { contact: contato }) || "Retorno de reavaliação";
  const { data: criada, error } = await admin
    .from("crm_tasks")
    .insert({
      id: randomUUID(),
      organization_id: args.organizationId,
      title: titulo,
      description: args.descricao,
      due_date: new Date().toISOString(),
      priority: "high",
      status: "pending",
      contact_id: args.contactId,
      assigned_to: null,
      created_by: null,
    })
    .select("id")
    .maybeSingle();
  if (error || !criada) {
    logger.warn("clinica_tarefa_do_retorno_nao_criada", {
      requestId: args.requestId,
      error: error?.message,
    });
    return;
  }
  await audit({
    action: "crm_task.created",
    resourceType: "crm_task",
    resourceId: criada.id as string,
    organizationId: args.organizationId,
    requestId: args.requestId,
    metadata: {
      origem: "clinica:retorno_de_reavaliacao",
      contact_id: args.contactId,
      prioridade: "high",
    },
  });
}
