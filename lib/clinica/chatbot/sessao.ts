/**
 * "Esta conexão é atendida pelo chatbot de menu?" — a pergunta que o drain do agente de IA faz
 * antes de enfileirar um turno (`lib/agent-engine/edge/crm/drain.ts`).
 *
 * Com o chatbot ligado, a IA não responde nessa conexão: é o "no lugar da IA" do pedido do Pedro
 * (02/10/2026), e é o que garante uma voz só. Lê o mesmo `metadata` da conexão, pela mesma porta
 * (`configDoMetadata`), que o chatbot e a tela usam.
 *
 * Fail-open: se a leitura falhar, devolve `false` e a IA segue como antes. Calar a IA na dúvida
 * deixaria o paciente sem ninguém.
 */
import type pg from "pg";

import { chatbotLigado } from "./config";

export async function chatbotDeMenuLigadoNaSessao(
  pool: Pick<pg.Pool, "query">,
  organizationId: string,
  channelSessionId: string,
): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ metadata: unknown }>(
      "select metadata from channel_sessions where organization_id = $1 and id = $2",
      [organizationId, channelSessionId],
    );
    return chatbotLigado(rows[0]?.metadata ?? null);
  } catch {
    return false;
  }
}
