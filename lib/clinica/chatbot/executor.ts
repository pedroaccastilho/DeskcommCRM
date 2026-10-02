/**
 * O CHATBOT DE MENU LIGADO AO MUNDO: lê a mensagem, chama o motor e responde pelo WhatsApp.
 *
 * Consumidor de `message.received` no dispatcher do `event_log` (`./handler.ts`). Roda no laço
 * do worker e, como rede de segurança, no cron `event-log-drain` — os dois reivindicam cada
 * evento uma vez só.
 *
 * ── Quando o chatbot NÃO responde (e a mensagem segue o caminho de sempre) ──────────────────
 *   - a conexão não tem chatbot ligado (o caso de toda instalação que não o configurou);
 *   - conversa de grupo, contato bloqueado (opt-out);
 *   - uma pessoa da equipe está com a conversa (dono humano, `force_human`, bot silenciado);
 *   - já chegou mensagem mais nova do paciente: ela tem o próprio evento, e responder às duas
 *     mandaria dois menus;
 *   - um follow-up vivo está esperando a resposta desse contato: duas vozes, não.
 *
 * ── Uma voz só ──────────────────────────────────────────────────────────────────────────────
 * Com o chatbot ligado na conexão, o drain do agente de IA pula o turno
 * (`lib/agent-engine/edge/crm/drain.ts`, `chatbotDeMenuLigadoNaSessao`). Sem isso o paciente
 * receberia o menu E a resposta da IA.
 *
 * ── Segurança ───────────────────────────────────────────────────────────────────────────────
 * Cliente service role: TODA consulta filtra `organization_id`, e a organização vem da LINHA do
 * evento (fonte confiável), nunca do payload. A agenda é lida e escrita pelas MESMAS funções da
 * tela e da IA (`lib/agenda/consulta.ts`, `app/api/v1/agenda/agendamentos/_handler.ts`), com as
 * regras da clínica penduradas nelas. O envio passa por `sendMessageHandler` (anti-banimento,
 * modo de teste do canal, auditoria) com espaçamento entre mensagens (`espacarEnvio`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  alterarAgendamentoHandler,
  cancelarAgendamentoHandler,
  marcarAgendamentoHandler,
} from "@/app/api/v1/agenda/agendamentos/_handler";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { horariosLivresDaOrg, listaAgendamentos, listaTiposDeAtendimento } from "@/lib/agenda/consulta";
import type { Actor } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { serviceFromMessage } from "@/lib/atendimento/origem-mensagem";
import { espacarEnvio } from "@/lib/automation/throttle";
import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { multaDoCancelamento } from "@/lib/clinica/agenda";
import { politicaDaOrganizacao, precoDoTipo, tipoDaClinica } from "@/lib/clinica/regras-da-agenda";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { humanoNoComando } from "@/lib/followup/gatilho-retorno";
import { logger } from "@/lib/logger";
import { resolveUserNames } from "@/lib/mcp/tools/_users";
import { formatCents } from "@/lib/money";
import { rotuloLocal } from "@/lib/tempo/agora";

import { configDoMetadata } from "./config";
import {
  HORARIOS_POR_VEZ,
  responder,
  type CompromissoDoPaciente,
  type DepsDoChatbot,
  type EstadoDoChatbot,
  type HorarioOferecido,
} from "./motor";

/** A chave do estado dentro de `conversations.metadata`. */
export const CHAVE_DO_ESTADO = "chatbot_menu";

/** Quantos dias à frente o chatbot procura horário livre. */
const DIAS_DE_BUSCA = 14;
/** Teto de agendas consultadas quando o tipo não tem responsável padrão. */
const MAXIMO_DE_PROFISSIONAIS = 6;
/** Quantos dias à frente contam como "próximos horários" do paciente. */
const DIAS_DOS_PROXIMOS = 62;

export type DesfechoDoChatbot =
  | { tipo: "respondeu"; mensagens: number; recepcao: boolean; falhou?: true }
  | { tipo: "pulou"; motivo: string };

interface ConversaLida {
  id: string;
  contact_id: string | null;
  channel_session_id: string | null;
  is_group: boolean | null;
  force_human: boolean | null;
  assignee_kind: string | null;
  bot_silenced_until: string | null;
  metadata: Record<string, unknown> | null;
  contacts: { is_blocked: boolean | null } | { is_blocked: boolean | null }[] | null;
  channel_sessions: { metadata: unknown } | { metadata: unknown }[] | null;
}

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** O estado gravado, se tiver a forma que o motor gravou. Forma estranha recomeça do menu. */
export function estadoDoMetadata(metadata: Record<string, unknown> | null): EstadoDoChatbot | null {
  const bruto = metadata?.[CHAVE_DO_ESTADO];
  if (!bruto || typeof bruto !== "object") return null;
  const e = bruto as Record<string, unknown>;
  if (typeof e.etapa !== "string" || typeof e.atualizado_em !== "string") return null;
  if (typeof e.erros !== "number") return null;
  return bruto as EstadoDoChatbot;
}

/** Até `teto` horários, alternando entre os dias, para a lista não ser só "amanhã cedo". */
export function espalharPorDia<T extends { dia: string }>(itens: readonly T[], teto: number): T[] {
  const porDia = new Map<string, T[]>();
  for (const item of itens) {
    const lista = porDia.get(item.dia);
    if (lista) lista.push(item);
    else porDia.set(item.dia, [item]);
  }
  const escolhidos: T[] = [];
  for (let rodada = 0; escolhidos.length < teto; rodada += 1) {
    let achou = false;
    for (const lista of porDia.values()) {
      const item = lista[rodada];
      if (item === undefined) continue;
      achou = true;
      escolhidos.push(item);
      if (escolhidos.length >= teto) break;
    }
    if (!achou) break;
  }
  return escolhidos;
}

export async function atenderComChatbot(
  admin: SupabaseClient,
  row: EventRow,
): Promise<DesfechoDoChatbot> {
  const org = row.organization_id;
  const conversaId = texto(row.payload.conversation_id);
  const mensagemId = texto(row.payload.message_id) ?? texto(row.entity_id);
  if (!conversaId || !mensagemId) return { tipo: "pulou", motivo: "payload_incompleto" };

  const { data: conversaBruta, error: erroConversa } = await admin
    .from("conversations")
    .select(
      "id, contact_id, channel_session_id, is_group, force_human, assignee_kind, bot_silenced_until, metadata, " +
        "contacts:contact_id(is_blocked), channel_sessions:channel_session_id(metadata)",
    )
    .eq("organization_id", org)
    .eq("id", conversaId)
    .maybeSingle();
  if (erroConversa) throw new Error(erroConversa.message);
  const conversa = conversaBruta as unknown as ConversaLida | null;
  if (!conversa || !conversa.channel_session_id || !conversa.contact_id) {
    return { tipo: "pulou", motivo: "conversa_inexistente" };
  }

  // O caso de quase toda mensagem: a conexão não tem chatbot ligado. Sai antes de qualquer
  // outra consulta.
  const config = configDoMetadata(um(conversa.channel_sessions)?.metadata ?? null);
  if (!config?.ativo) return { tipo: "pulou", motivo: "chatbot_desligado" };

  if (conversa.is_group !== false) return { tipo: "pulou", motivo: "grupo" };
  if (um(conversa.contacts)?.is_blocked) return { tipo: "pulou", motivo: "contato_bloqueado" };
  const agora = new Date();
  if (
    humanoNoComando(
      {
        is_group: false,
        is_blocked: false,
        force_human: conversa.force_human === true,
        assignee_kind: conversa.assignee_kind,
        bot_silenced_until: conversa.bot_silenced_until,
        tags: [],
      },
      agora,
    )
  ) {
    return { tipo: "pulou", motivo: "humano_no_comando" };
  }

  const { data: ultima, error: erroUltima } = await admin
    .from("messages")
    .select("id, body")
    .eq("organization_id", org)
    .eq("conversation_id", conversaId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (erroUltima) throw new Error(erroUltima.message);
  if (!ultima || ultima.id !== mensagemId) return { tipo: "pulou", motivo: "mensagem_superada" };

  const { count: fluxosVivos, error: erroFluxos } = await admin
    .from("followup_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org)
    .eq("contact_id", conversa.contact_id)
    .in("status", ["waiting_reply", "coletando"]);
  if (erroFluxos) throw new Error(erroFluxos.message);
  if ((fluxosVivos ?? 0) > 0) return { tipo: "pulou", motivo: "followup_esperando_resposta" };

  const fronteira = await serviceFromMessage(admin, org, mensagemId);
  if (!fronteira || fronteira.conversation_id !== conversaId) {
    return { tipo: "pulou", motivo: "fronteira_obsoleta" };
  }

  const sessaoId = conversa.channel_session_id;
  const contatoId = conversa.contact_id;
  const actor: Actor = { type: "webhook_source", id: `chatbot-menu:${sessaoId}` };
  const deps = depsReais(admin, { org, contatoId, conversaId, actor, mensagemId });

  const resposta = await responder(
    config,
    estadoDoMetadata(conversa.metadata),
    String(ultima.body ?? ""),
    deps,
  );

  // Estado ANTES do envio: se o envio falhar no meio, a próxima mensagem do paciente continua
  // da etapa certa, em vez de repetir uma marcação que já aconteceu.
  const metadata = { ...(conversa.metadata ?? {}) };
  if (resposta.estado === null) delete metadata[CHAVE_DO_ESTADO];
  else metadata[CHAVE_DO_ESTADO] = resposta.estado;
  const { error: erroEstado } = await admin
    .from("conversations")
    .update({ metadata })
    .eq("organization_id", org)
    .eq("id", conversaId);
  if (erroEstado) {
    logger.warn("[clinica.chatbot] estado da conversa não gravado", {
      conversation_id: conversaId,
      error: erroEstado.message,
    });
  }

  // Daqui em diante o evento NÃO pode voltar para a fila: o estado já avançou, e reprocessar a
  // mesma mensagem na etapa nova poderia marcar um horário que o paciente não escolheu. Falha de
  // envio vira log e desfecho, nunca exceção.
  let enviadas = 0;
  try {
    for (const [i, corpo] of resposta.mensagens.entries()) {
      await espacarEnvio(sessaoId);
      await sendMessageHandler(
        admin,
        {
          organization_id: org,
          serviceBoundary: fronteira,
          actor,
          requestId: `chatbot-menu:${mensagemId}:${i}`,
        },
        { conversation_id: conversaId, type: "text", body: corpo } as Parameters<typeof sendMessageHandler>[2],
      );
      enviadas += 1;
    }
    if (resposta.passarParaRecepcao) {
      await passarParaARecepcao(admin, { org, conversaId, fronteira });
    }
  } catch (err) {
    logger.error("[clinica.chatbot] resposta interrompida", {
      conversation_id: conversaId,
      enviadas,
      error: err instanceof Error ? err.message : String(err),
    });
    return { tipo: "respondeu", mensagens: enviadas, recepcao: false, falhou: true };
  }
  return { tipo: "respondeu", mensagens: enviadas, recepcao: resposta.passarParaRecepcao };
}

/**
 * A conversa vai para a equipe pelo caminho canônico (`triggerHandoff`): status pendente, bot
 * silenciado, aviso na Central e a linha de passagem. O aviso ao cliente que esse caminho manda
 * só sai quando a IA falou na conversa — aqui quem falou foi o chatbot, que já mandou o texto da
 * recepção. Se o caminho canônico recusar (conversa fora do alcance da automação), o bot é
 * calado à mão, para não seguir respondendo depois de dizer que a equipe assume.
 */
async function passarParaARecepcao(
  admin: SupabaseClient,
  p: { org: string; conversaId: string; fronteira: Awaited<ReturnType<typeof serviceFromMessage>> },
): Promise<void> {
  const r = await triggerHandoff({
    conversationId: p.conversaId,
    organizationId: p.org,
    reason: "requested_human",
    origem: "pedido_explicito",
    ...(p.fronteira ? { serviceBoundary: p.fronteira } : {}),
    motivoTexto: "O paciente pediu a recepção pelo chatbot de menu.",
    metadata: { source: "chatbot_menu" },
  });
  if (r.triggered || r.reason === "idempotent_5s") return;
  logger.warn("[clinica.chatbot] passagem canônica recusada; silenciando à mão", {
    conversation_id: p.conversaId,
    reason: r.reason,
  });
  const agora = new Date().toISOString();
  const { error } = await admin
    .from("conversations")
    .update({
      status: "pending",
      bot_silenced_until: "infinity",
      last_handoff_at: agora,
      last_handoff_reason: "requested_human",
      status_changed_at: agora,
    })
    .eq("organization_id", p.org)
    .eq("id", p.conversaId);
  if (error) {
    logger.error("[clinica.chatbot] não consegui silenciar o bot", {
      conversation_id: p.conversaId,
      error: error.message,
    });
  }
}

const NAO_CONSEGUI = "Não consegui fazer isso por aqui agora.";

function falhaDaAgenda(e: unknown): { ok: false; mensagem: string; horarioTomado?: boolean } {
  if (!(e instanceof ApiError)) throw e;
  if (e.code === "agenda_horario_indisponivel" || e.code === "agenda_fora_da_jornada") {
    return { ok: false, mensagem: NAO_CONSEGUI, horarioTomado: true };
  }
  return { ok: false, mensagem: NAO_CONSEGUI };
}

/** Um horário livre como o paciente lê: "Ter 06/10 às 09:00", no fuso da agenda. */
function horarioDoSlot(inicio: Date, fuso: string): { inicio: string; rotulo: string; dia: string } {
  const rotulo = rotuloLocal(inicio, fuso);
  // "Ter 06/10" — o rótulo começa pelo dia; é por ele que a lista se espalha.
  return { inicio: inicio.toISOString(), rotulo, dia: rotulo.slice(0, 9) };
}

/**
 * Quem atende a modalidade do tipo (módulo clínica): profissionais ativos com essa modalidade.
 * Vazio quando o tipo não tem modalidade, ou o módulo não está instalado.
 */
async function profissionaisDoTipo(
  admin: SupabaseClient,
  org: string,
  tipoId: string,
): Promise<Array<{ userId: string; primeiroNome: string }>> {
  const daClinica = await tipoDaClinica(admin, org, tipoId);
  if (!daClinica) return [];
  const { data, error } = await admin
    .from("clinica_profissionais")
    .select("user_id, nome_profissional")
    .eq("organization_id", org)
    .eq("ativo", true)
    .contains("modalidades", [daClinica.modalidade])
    .order("nome_profissional")
    .limit(MAXIMO_DE_PROFISSIONAIS);
  if (error) {
    logger.warn("[clinica.chatbot] profissionais da modalidade não lidos", { error: error.message });
    return [];
  }
  return ((data ?? []) as Array<{ user_id: string; nome_profissional: string }>).map((p) => ({
    userId: p.user_id,
    primeiroNome: p.nome_profissional.trim().split(/\s+/)[0] ?? p.nome_profissional,
  }));
}

function depsReais(
  admin: SupabaseClient,
  c: { org: string; contatoId: string; conversaId: string; actor: Actor; mensagemId: string },
): DepsDoChatbot {
  const ctx = (sufixo: string) => ({
    organization_id: c.org,
    actor: c.actor,
    requestId: `chatbot-menu:${c.mensagemId}:${sufixo}`,
  });

  return {
    agora: () => new Date(),
    formatarDinheiro: (cents, moeda) => formatCents(cents, moeda ?? "BRL"),

    async tiposParaMarcar() {
      const r = await listaTiposDeAtendimento(admin, c.org);
      if (!r.ok) return { ok: false, mensagem: NAO_CONSEGUI };
      return { ok: true, tipos: r.tipos.map((t) => ({ id: t.id, nome: t.nome })) };
    },

    async horariosLivres(tipo, remarcando) {
      const agora = new Date();
      const consultar = (donoId: string | null) =>
        horariosLivresDaOrg(admin, c.org, {
          eventTypeId: tipo.id,
          ownerUserId: donoId,
          de: agora,
          ate: new Date(agora.getTime() + DIAS_DE_BUSCA * 86_400_000),
          agora,
          ...(remarcando ? { ignorarAgendamentoId: remarcando.ignorarCompromissoId } : {}),
        });

      // Remarcar fica com quem já atende o paciente; marcar usa o responsável do tipo.
      const primeira = await consultar(remarcando?.donoId ?? null);
      let candidatos: Array<{ inicio: string; rotulo: string; dia: string; donoId?: string }>;
      if (primeira.ok) {
        candidatos = primeira.slots.map((s) => horarioDoSlot(s.inicio, primeira.fusoDaRegra));
      } else if (primeira.codigo === "sem_responsavel" && !remarcando) {
        // Tipo sem responsável padrão (clínica com vários profissionais na mesma modalidade):
        // junta a agenda de quem atende a modalidade, e cada horário leva o nome de quem atende.
        const profissionais = await profissionaisDoTipo(admin, c.org, tipo.id);
        const porProfissional = await Promise.all(
          profissionais.map(async (p) => ({ p, r: await consultar(p.userId) })),
        );
        candidatos = porProfissional.flatMap(({ p, r }) =>
          r.ok
            ? r.slots.map((s) => {
                const h = horarioDoSlot(s.inicio, r.fusoDaRegra);
                return { ...h, rotulo: `${h.rotulo} com ${p.primeiroNome}`, donoId: p.userId };
              })
            : [],
        );
        if (profissionais.length === 0) {
          return { ok: false, mensagem: "Não consegui ver os horários livres agora." };
        }
      } else {
        return { ok: false, mensagem: "Não consegui ver os horários livres agora." };
      }
      const horarios: HorarioOferecido[] = espalharPorDia(
        [...candidatos].sort((a, b) => a.inicio.localeCompare(b.inicio)),
        HORARIOS_POR_VEZ,
      )
        .sort((a, b) => a.inicio.localeCompare(b.inicio))
        .map(({ inicio, rotulo, donoId }) => ({ inicio, rotulo, ...(donoId ? { donoId } : {}) }));
      return { ok: true, horarios };
    },

    async proximosCompromissos() {
      const agora = new Date();
      const r = await listaAgendamentos(admin, c.org, {
        contactId: c.contatoId,
        de: agora.toISOString(),
        ate: new Date(agora.getTime() + DIAS_DOS_PROXIMOS * 86_400_000).toISOString(),
        limite: 20,
      });
      if (!r.ok) return { ok: false, mensagem: "Não consegui ver a sua agenda agora." };
      const vivos = r.agendamentos
        .filter((a) => a.situacao === "pending" || a.situacao === "confirmed")
        .slice(0, 9);
      const nomes = await resolveUserNames(admin, vivos.map((a) => a.donoId));
      const tipos = await listaTiposDeAtendimento(admin, c.org);
      const idPorSlug = new Map(tipos.ok ? tipos.tipos.map((t) => [t.slug, t.id]) : []);
      const compromissos: CompromissoDoPaciente[] = vivos.map((a) => {
        const dono = a.donoId ? nomes.get(a.donoId)?.split(" ")[0] : undefined;
        const oQue = a.tipo?.nome ?? a.titulo;
        return {
          id: a.id,
          rotulo: `${rotuloLocal(new Date(a.iniciaEm), a.fuso)} · ${oQue}${dono ? ` com ${dono}` : ""}`,
          tipoId: a.tipo ? (idPorSlug.get(a.tipo.slug) ?? null) : null,
          tipoNome: a.tipo?.nome ?? null,
          donoId: a.donoId,
          ...(a.revision !== undefined ? { revision: a.revision } : {}),
        };
      });
      return { ok: true, compromissos };
    },

    async marcar(tipo, horario) {
      try {
        const r = await marcarAgendamentoHandler(admin, ctx("marcar"), {
          event_type_id: tipo.id,
          starts_at: horario.inicio,
          ...(horario.donoId ? { owner_user_id: horario.donoId } : {}),
          contact_id: c.contatoId,
          conversation_id: c.conversaId,
        });
        return { ok: true, aguardaConfirmacao: r.status === "pending" };
      } catch (e) {
        return falhaDaAgenda(e);
      }
    },

    async remarcar(compromisso, inicio) {
      try {
        await alterarAgendamentoHandler(admin, ctx("remarcar"), {
          id: compromisso.id,
          starts_at: inicio,
          ...(compromisso.revision !== undefined ? { revision: compromisso.revision } : {}),
        });
        return { ok: true };
      } catch (e) {
        return falhaDaAgenda(e);
      }
    },

    async cancelar(compromisso) {
      try {
        await cancelarAgendamentoHandler(admin, ctx("cancelar"), {
          id: compromisso.id,
          reason: "O paciente cancelou pelo chatbot do WhatsApp.",
          cancelado_por: "paciente",
        });
        return { ok: true };
      } catch (e) {
        return falhaDaAgenda(e);
      }
    },

    async multaSeCancelarAgora(compromisso) {
      // Só sessão da clínica tem multa (o tipo tem modalidade). Sem o módulo, ou num tipo que
      // não é da clínica, `tipoDaClinica` devolve null e não há o que avisar.
      if (!compromisso.tipoId) return null;
      const daClinica = await tipoDaClinica(admin, c.org, compromisso.tipoId);
      if (!daClinica) return null;
      const { data: linha } = await admin
        .from("calendar_appointments")
        .select("starts_at")
        .eq("organization_id", c.org)
        .eq("id", compromisso.id)
        .maybeSingle();
      const inicio = texto((linha as { starts_at?: unknown } | null)?.starts_at);
      if (!inicio) return null;
      const [politica, preco] = await Promise.all([
        politicaDaOrganizacao(admin, c.org),
        precoDoTipo(admin, c.org, compromisso.tipoId),
      ]);
      const multa = multaDoCancelamento({
        inicio: new Date(inicio),
        canceladoEm: new Date(),
        politica,
        valorDaSessaoCents: preco?.valor_cents ?? null,
        quemCancelou: "paciente",
      });
      if (!multa) return null;
      return {
        percentual: multa.percentual,
        antecedenciaHoras: politica.antecedencia_cancelamento_horas,
        valorCents: multa.valor_cents,
        ...(preco ? { moeda: preco.currency } : {}),
      };
    },
  };
}
