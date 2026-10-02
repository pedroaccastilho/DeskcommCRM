/**
 * O CHATBOT DE MENU — a configuração de UMA conexão de WhatsApp (módulo clínica, fork TOQ).
 *
 * Pedido do Pedro (02/10/2026): poder responder o WhatsApp com um chatbot de regras (menu com
 * opções numeradas, fluxo fixo) no lugar da IA. Quem monta não é técnico, então a configuração é
 * um formulário: uma saudação, de 1 a 9 opções e dois textos de apoio. Cada opção faz uma coisa
 * fixa (marcar horário, ver o próximo, remarcar ou cancelar, chamar a recepção, mandar um texto).
 *
 * ── Onde mora ───────────────────────────────────────────────────────────────────────────────
 * Em `channel_sessions.metadata.chatbot_menu`, ao lado de `ai_gate`: é configuração DO NÚMERO, e
 * o número já tem o seu `metadata` (DIRC: referenciar, não duplicar). Sem tabela nova, então sem
 * migration e sem provisionadora. Este schema é a ÚNICA porta de leitura e escrita desse caminho
 * (anti-pattern 6: nada lê o jsonb direto sem passar por aqui).
 *
 * ── O que "ativo" significa ─────────────────────────────────────────────────────────────────
 * Ligado, o chatbot responde TODA mensagem dessa conexão e a IA fica calada nela (o drain do
 * agente pula o turno: `lib/agent-engine/edge/crm/drain.ts`). Desligado, nada aqui é lido e a
 * conexão segue como estava.
 */
import { z } from "zod";

/** A chave dentro de `channel_sessions.metadata`. */
export const CHAVE_NO_METADATA = "chatbot_menu";

export const ACOES_DO_MENU = [
  "agendar",
  "proximo_horario",
  "remarcar_cancelar",
  "recepcao",
  "texto",
] as const;
export type AcaoDoMenu = (typeof ACOES_DO_MENU)[number];

export const ROTULO_DA_ACAO: Record<AcaoDoMenu, string> = {
  agendar: "Marcar um horário",
  proximo_horario: "Ver meus próximos horários",
  remarcar_cancelar: "Remarcar ou cancelar",
  recepcao: "Falar com a recepção",
  texto: "Responder com um texto fixo",
};

export const MAXIMO_DE_OPCOES = 9;

export const opcaoDoMenuSchema = z
  .strictObject({
    rotulo: z.string().trim().min(1, "Dê um nome à opção").max(60),
    acao: z.enum(ACOES_DO_MENU),
    /** Só na ação `texto`: o que o chatbot responde. */
    texto: z.string().trim().max(1000).optional(),
  })
  .refine((o) => o.acao !== "texto" || (o.texto ?? "").length > 0, {
    message: "A opção de texto fixo precisa do texto da resposta",
    path: ["texto"],
  });
export type OpcaoDoMenu = z.infer<typeof opcaoDoMenuSchema>;

export const configDoChatbotSchema = z.strictObject({
  ativo: z.boolean(),
  saudacao: z.string().trim().min(1, "Escreva a saudação").max(1000),
  opcoes: z
    .array(opcaoDoMenuSchema)
    .min(1, "Crie ao menos uma opção")
    .max(MAXIMO_DE_OPCOES, `No máximo ${MAXIMO_DE_OPCOES} opções`),
  nao_entendi: z.string().trim().min(1).max(500),
  recepcao: z.string().trim().min(1).max(500),
  /**
   * Depois de quantas horas sem falar o chatbot recomeça do menu. Uma conversa de ontem que
   * parou no meio da marcação não deve continuar dali hoje.
   */
  reiniciar_apos_horas: z.number().int().min(1).max(72),
});
export type ConfigDoChatbot = z.infer<typeof configDoChatbotSchema>;

/** O ponto de partida da tela: o que faz sentido para a TOQ, editável por inteiro. */
export const CONFIG_PADRAO: Readonly<ConfigDoChatbot> = Object.freeze({
  ativo: false,
  saudacao: "Olá! Aqui é a TOQ - Clínica do Movimento. Como posso ajudar?",
  opcoes: [
    { rotulo: "Marcar um horário", acao: "agendar" },
    { rotulo: "Ver meus próximos horários", acao: "proximo_horario" },
    { rotulo: "Remarcar ou cancelar", acao: "remarcar_cancelar" },
    { rotulo: "Falar com a recepção", acao: "recepcao" },
  ],
  nao_entendi: "Não entendi. Responda só com o número de uma das opções.",
  recepcao: "Certo! Vou chamar alguém da recepção, que já te responde por aqui.",
  reiniciar_apos_horas: 12,
} satisfies ConfigDoChatbot);

/**
 * A configuração gravada no `metadata` da conexão, ou `null` quando não há (ou está quebrada).
 * Nunca lança: um jsonb malformado deixa o chatbot DESLIGADO, e a conexão segue como estava.
 */
export function configDoMetadata(metadata: unknown): ConfigDoChatbot | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const bruto = (metadata as Record<string, unknown>)[CHAVE_NO_METADATA];
  if (bruto === undefined) return null;
  const lido = configDoChatbotSchema.safeParse(bruto);
  return lido.success ? lido.data : null;
}

/** O chatbot responde nesta conexão? (configuração válida E ligada) */
export function chatbotLigado(metadata: unknown): boolean {
  return configDoMetadata(metadata)?.ativo === true;
}
