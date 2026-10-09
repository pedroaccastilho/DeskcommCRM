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
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { IDIOMA_PADRAO } from "@/lib/i18n/idiomas";
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
import { fraseDoChoque, sessaoQueChoca } from "./choque-do-paciente";
import { exigePodeMarcarASessao } from "./presenca-servidor";
import { consumoDaTransicao, type MotivoDoConsumo } from "./pacotes";
import { lancarSessaoNoPacote, valorDaSessaoPeloPacote } from "./pacotes-servidor";

type SB = SupabaseClient;

export interface TipoDaClinica {
  modalidade: Modalidade;
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
    .select("modalidade")
    .eq("organization_id", organizationId)
    .eq("event_type_id", eventTypeId)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) return null;
    throw error;
  }
  return (data as TipoDaClinica | null) ?? null;
}

/**
 * O preço da sessão avulsa do tipo, base da multa, ou `null` (tipo sem preço).
 *
 * É o "Preço padrão" do tipo de agendamento do NÚCLEO (`calendar_event_types.default_price_cents`,
 * o mesmo que a comanda sugere): a clínica não guarda segundo preço (migration 9003). A moeda é a
 * que a organização declarou.
 */
export async function precoDoTipo(
  db: SB,
  organizationId: string,
  eventTypeId: string,
): Promise<{ valor_cents: number; currency: string } | null> {
  const { data, error } = await db
    .from("calendar_event_types")
    .select("default_price_cents")
    .eq("organization_id", organizationId)
    .eq("id", eventTypeId)
    .maybeSingle();
  if (error) throw error;
  const bruto = (data as { default_price_cents: number | string | null } | null)
    ?.default_price_cents;
  if (bruto === null || bruto === undefined) return null;
  return { valor_cents: Number(bruto), currency: await moedaDaOrganizacao(db, organizationId) };
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

/** A hora no fuso da clínica e no idioma de quem chamou (MCP e webhook caem no padrão). */
function horaParaQuemLe(instante: Date, ctx: HandlerCtx): string {
  return new Intl.DateTimeFormat(tagDeIdioma(ctx.idioma ?? IDIOMA_PADRAO), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(instante);
}

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
        `A falta pode ser registrada a partir das ${horaParaQuemLe(liberada, ctx)}.`,
    );
  }
}

/**
 * ANTES de mudar o status de uma sessão da clínica: quem não é Administrador, Gerente nem
 * Recepção só registra a sessão da própria agenda (`lib/clinica/presenca.ts`). Só gente: o agente
 * de IA e o webhook seguem governados pelo papel do token.
 */
export async function presencaNaClinica(
  db: SB,
  ctx: HandlerCtx,
  compromisso: { eventTypeId: string | null; donoId: string | null },
): Promise<void> {
  if (ctx.actor.type !== "user") return;
  const tipo = await tipoDaClinica(db, ctx.organization_id, compromisso.eventTypeId);
  if (!tipo) return;
  await exigePodeMarcarASessao(
    ctx.organization_id,
    ctx.actor.id,
    compromisso.donoId,
    ctx.requestId,
  );
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
 * DEPOIS da gravação: histórico da sessão, a multa do cancelamento em cima da hora e o saldo do
 * pacote (migration 9004).
 *
 * Escreve com o client de serviço (as tabelas não têm policy de escrita para a sessão), e
 * por isso todo insert leva a organização do contexto autenticado, nunca do corpo. Cada parte
 * falha sozinha para o log: um histórico que não gravou não impede a sessão de sair do pacote.
 */
export async function depoisDaMudancaNaClinica(
  db: SB,
  ctx: HandlerCtx,
  mudanca: MudancaNaAgenda,
  agora: Date = new Date(),
): Promise<void> {
  const acao = acaoDoHistorico(mudanca.transicao);
  const consumo = consumoDaTransicao(mudanca.transicao);
  if (!acao && consumo === undefined) return;

  let tipo: TipoDaClinica | null;
  try {
    tipo = await tipoDaClinica(db, ctx.organization_id, mudanca.eventTypeId);
  } catch (err) {
    logger.error("[clinica] modalidade do tipo não pôde ser lida", {
      organization_id: ctx.organization_id,
      appointment_id: mudanca.appointmentId,
      error: mensagemDoErro(err),
    });
    return;
  }
  if (!tipo || !mudanca.eventTypeId) return;

  if (acao) await historicoEMulta(db, ctx, mudanca, acao, tipo, mudanca.eventTypeId, agora);
  if (consumo !== undefined) await sessaoNoPacote(ctx, mudanca, tipo, consumo);
}

function mensagemDoErro(err: unknown): string {
  return err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
}

async function historicoEMulta(
  db: SB,
  ctx: HandlerCtx,
  mudanca: MudancaNaAgenda,
  acao: NonNullable<ReturnType<typeof acaoDoHistorico>>,
  tipo: TipoDaClinica,
  eventTypeId: string,
  agora: Date,
): Promise<void> {
  try {
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
    // Dentro do pacote, a multa é sobre o valor da sessão no pacote (total / sessões); fora
    // dele, sobre o preço avulso do tipo. Lido com o client de serviço: quem cancelou pode ser a
    // IA ou um perfil que não vê valor de pacote.
    const preco =
      (await valorDaSessaoPeloPacote(
        admin,
        ctx.organization_id,
        mudanca.contactId,
        tipo.modalidade,
        mudanca.deInicio,
      )) ?? (await precoDoTipo(db, ctx.organization_id, eventTypeId));
    const multa = multaDoCancelamento({
      inicio: mudanca.deInicio,
      canceladoEm: agora,
      politica,
      valorDaSessaoCents: preco?.valor_cents ?? null,
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
        currency: preco?.currency ?? "BRL",
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
      error: mensagemDoErro(err),
    });
  }
}

/**
 * Realizada e falta gastam uma sessão do pacote; o que deixa de contar (cancelada, remarcada,
 * de volta para agendada) devolve. Sessão sem pacote válido é avulsa e não mexe em nada.
 */
async function sessaoNoPacote(
  ctx: HandlerCtx,
  mudanca: MudancaNaAgenda,
  tipo: TipoDaClinica,
  consumo: MotivoDoConsumo | null,
): Promise<void> {
  try {
    const lancamento = await lancarSessaoNoPacote(
      createAdminClient(),
      ctx.organization_id,
      mudanca.appointmentId,
      tipo.modalidade,
      consumo,
    );
    if (!lancamento || lancamento.acao === "ja_lancada") return;
    await audit({
      action:
        lancamento.acao === "lancada"
          ? "clinica.pacote_sessao_lancada"
          : "clinica.pacote_sessao_estornada",
      actorUserId: ctx.actor.type === "user" ? ctx.actor.id : null,
      organizationId: ctx.organization_id,
      resourceType: "clinica_pacote",
      resourceId: lancamento.pacote_id,
      requestId: ctx.requestId,
      metadata: { appointment_id: mudanca.appointmentId, motivo: consumo, saldo: lancamento.saldo },
    });
  } catch (err) {
    logger.error("[clinica] sessão não lançada no pacote", {
      organization_id: ctx.organization_id,
      appointment_id: mudanca.appointmentId,
      transicao: mudanca.transicao,
      error: mensagemDoErro(err),
    });
  }
}

/** Até quantas sessões do paciente a conferência lê numa janela (uma sessão já basta para recusar). */
const LIMITE_DO_CHOQUE = 20;

/**
 * O PACIENTE JÁ TEM SESSÃO NESSE HORÁRIO? Recusa com 422 `agenda_paciente_ocupado`.
 *
 * Chamada por `lib/agenda/regras-de-modulo.ts` (`antesDeOcupar`) ao MARCAR e ao REMARCAR, no
 * handler que a tela, o agente de IA e o chatbot do WhatsApp usam. A agenda de quem atende segue
 * individual (o núcleo cuida dela); aqui a pergunta é só sobre o paciente: com QUALQUER
 * profissional, uma sessão viva que cruza o pedido recusa.
 *
 * Vale só quando o compromisso novo é sessão da clínica (tipo com modalidade) e tem paciente. O
 * que já está na agenda do paciente conta inteiro, seja de qual tipo for.
 */
export async function pacienteLivreNaClinica(
  db: SB,
  ctx: HandlerCtx,
  pedido: {
    eventTypeId: string | null;
    contactId: string | null;
    inicio: Date;
    fim: Date;
    ignorarAgendamentoId?: string;
  },
): Promise<void> {
  if (!pedido.contactId) return;
  const daClinica = await tipoDaClinica(db, ctx.organization_id, pedido.eventTypeId);
  if (!daClinica) return;

  const { data, error } = await db
    .from("calendar_appointments")
    .select("id, starts_at, ends_at, status, time_zone, owner_user_id, event_type_id, title")
    .eq("organization_id", ctx.organization_id)
    .eq("contact_id", pedido.contactId)
    .lt("starts_at", pedido.fim.toISOString())
    .gt("ends_at", pedido.inicio.toISOString())
    .order("starts_at")
    .limit(LIMITE_DO_CHOQUE);
  if (error) throw error;

  type Linha = {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    time_zone: string | null;
    owner_user_id: string | null;
    event_type_id: string | null;
    title: string | null;
  };
  const linhas = (data ?? []) as Linha[];
  const choque = sessaoQueChoca(
    linhas.map((l) => ({
      ...l,
      inicio: new Date(l.starts_at),
      fim: new Date(l.ends_at),
    })),
    { inicio: pedido.inicio, fim: pedido.fim, ignorarId: pedido.ignorarAgendamentoId },
  );
  if (!choque) return;

  const [tipo, profissional] = await Promise.all([
    choque.event_type_id
      ? db
          .from("calendar_event_types")
          .select("name")
          .eq("organization_id", ctx.organization_id)
          .eq("id", choque.event_type_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    choque.owner_user_id
      ? db
          .from("clinica_profissionais")
          .select("nome_profissional")
          .eq("organization_id", ctx.organization_id)
          .eq("user_id", choque.owner_user_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const nomeDoTipo = (tipo.data as { name?: string } | null)?.name ?? choque.title ?? null;
  const nomeDoProfissional =
    (profissional.data as { nome_profissional?: string } | null)?.nome_profissional ?? null;

  throw new ApiError(
    422,
    "agenda_paciente_ocupado",
    {
      appointment_id: choque.id,
      starts_at: choque.starts_at,
      ends_at: choque.ends_at,
      owner_user_id: choque.owner_user_id,
    },
    ctx.requestId,
    fraseDoChoque({
      tipo: nomeDoTipo,
      profissional: nomeDoProfissional,
      inicio: choque.inicio,
      fim: choque.fim,
      fuso: choque.time_zone ?? "America/Sao_Paulo",
      tag: tagDeIdioma(ctx.idioma ?? IDIOMA_PADRAO),
    }),
  );
}
