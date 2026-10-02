/**
 * Adapter fino que pluga o chatbot do WhatsApp (`./executor.ts`) no dispatcher do `event_log`.
 *
 * Registrado ANTES dos consumidores que só observam a mensagem (sentimento, RAG) e logo depois
 * do gatilho de retorno dos follow-ups, pelo mesmo critério dele: o paciente espera a resposta.
 * Numa conexão sem chatbot ligado ele sai na primeira consulta (`skipped chatbot_desligado`).
 *
 * `error` só volta quando nada foi enviado nem gravado (o executor garante): reprocessar depois
 * disso poderia repetir uma marcação.
 */
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { createAdminClient } from "@/lib/supabase/admin";

import { atenderComChatbot } from "./executor";

export const CHATBOT_HANDLER_KEY = "clinica-chatbot.v1";

export const chatbotHandler: EventHandler = {
  key: CHATBOT_HANDLER_KEY,
  // Responder é sair para fora (WhatsApp): organização parada não responde.
  naOrgParada: "pula",
  events: ["message.received"],
  async handle(row): Promise<HandlerResult> {
    try {
      const d = await atenderComChatbot(createAdminClient(), row);
      if (d.tipo === "pulou") {
        return { consumer_key: CHATBOT_HANDLER_KEY, status: "skipped", detail: d.motivo };
      }
      return {
        consumer_key: CHATBOT_HANDLER_KEY,
        status: "ok",
        detail: `mensagens=${d.mensagens} recepcao=${d.recepcao}${d.falhou ? " falhou" : ""}`,
      };
    } catch (err) {
      return {
        consumer_key: CHATBOT_HANDLER_KEY,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
