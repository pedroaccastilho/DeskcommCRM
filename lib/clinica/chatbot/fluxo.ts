/**
 * O CHATBOT DO WHATSAPP — o fluxo desenhado de UMA conexão (módulo clínica, fork TOQ).
 *
 * Pedido do Pedro (02/10/2026): responder o WhatsApp com um chatbot sem IA, montado num
 * construtor visual de caixas e setas, como o editor de fluxos dos Follow-ups. Cada caixa é um
 * passo da conversa; cada seta sai de uma SAÍDA nomeada da caixa (uma opção do menu, "marcou",
 * "não marcou") e entra noutra caixa.
 *
 * ── Por que não é o motor dos Follow-ups ────────────────────────────────────────────────────
 * O motor dos Follow-ups (`lib/followup/engine.ts`) avança de minuto em minuto pelo cron, tem
 * espera mínima de 15 minutos para a resposta e não conhece a agenda. Um chatbot responde em
 * segundos e marca consulta. O editor é o mesmo tipo (React Flow, cartões com uma bolinha por
 * saída); quem lê o fluxo desenhado é `./motor.ts`.
 *
 * ── Onde mora ───────────────────────────────────────────────────────────────────────────────
 * Em `channel_sessions.metadata.chatbot_fluxo`, ao lado de `ai_gate`: é configuração DO NÚMERO,
 * e o número já tem o seu `metadata` (DIRC: referenciar, não duplicar). Sem tabela nova, então
 * sem migration. Este arquivo é a ÚNICA porta de leitura e escrita desse caminho
 * (anti-pattern 6: nada lê o jsonb direto sem passar por aqui).
 *
 * ── O que "ativo" significa ─────────────────────────────────────────────────────────────────
 * Ligado, o chatbot responde TODA mensagem dessa conexão e a IA fica calada nela (o drain do
 * agente pula o turno: `lib/agent-engine/edge/crm/drain.ts`). Desligado, nada aqui é lido.
 */
import { z } from "zod";

/** A chave dentro de `channel_sessions.metadata`. */
export const CHAVE_NO_METADATA = "chatbot_fluxo";

export const TIPOS_DE_NO = [
  "inicio",
  "mensagem",
  "menu",
  "pergunta",
  "marcar",
  "proximos",
  "remarcar_cancelar",
  "recepcao",
  "fim",
] as const;
export type TipoDeNo = (typeof TIPOS_DE_NO)[number];

export const MAXIMO_DE_OPCOES = 9;
export const MAXIMO_DE_NOS = 60;

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id inválido");

const posicaoSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const textoSchema = (max: number, vazio: string) => z.string().trim().min(1, vazio).max(max);

const base = { id: idSchema, posicao: posicaoSchema };

export const opcaoDoMenuSchema = z.strictObject({
  id: idSchema,
  rotulo: textoSchema(60, "Dê um nome à opção"),
});
export type OpcaoDoMenu = z.infer<typeof opcaoDoMenuSchema>;

export const noSchema = z.discriminatedUnion("tipo", [
  z.strictObject({ ...base, tipo: z.literal("inicio") }),
  z.strictObject({
    ...base,
    tipo: z.literal("mensagem"),
    texto: textoSchema(2000, "Escreva a mensagem"),
  }),
  z
    .strictObject({
      ...base,
      tipo: z.literal("menu"),
      texto: textoSchema(1000, "Escreva a pergunta do menu"),
      opcoes: z
        .array(opcaoDoMenuSchema)
        .min(1, "Crie ao menos uma opção")
        .max(MAXIMO_DE_OPCOES, `No máximo ${MAXIMO_DE_OPCOES} opções`),
    })
    .refine((n) => new Set(n.opcoes.map((o) => o.id)).size === n.opcoes.length, {
      message: "Duas opções com o mesmo id",
      path: ["opcoes"],
    }),
  z.strictObject({
    ...base,
    tipo: z.literal("pergunta"),
    texto: textoSchema(1000, "Escreva a pergunta"),
    /** Onde guardar a resposta. `nome` grava no nome do contato. */
    guardar_em: z.enum(["nada", "nome"]),
  }),
  z.strictObject({
    ...base,
    tipo: z.literal("marcar"),
    /** Um tipo de atendimento fixo, ou `null` para o paciente escolher entre todos. */
    tipo_id: z.string().uuid().nullable(),
  }),
  z.strictObject({ ...base, tipo: z.literal("proximos") }),
  z.strictObject({ ...base, tipo: z.literal("remarcar_cancelar") }),
  z.strictObject({
    ...base,
    tipo: z.literal("recepcao"),
    texto: textoSchema(1000, "Escreva o aviso"),
  }),
  z.strictObject({ ...base, tipo: z.literal("fim"), texto: z.string().trim().max(1000) }),
]);
export type NoDoFluxo = z.infer<typeof noSchema>;
export type NoDe<T extends TipoDeNo> = Extract<NoDoFluxo, { tipo: T }>;

export const setaSchema = z.strictObject({
  id: idSchema,
  origem: idSchema,
  /** A saída da caixa de origem (`saidasDoNo`). */
  saida: idSchema,
  destino: idSchema,
});
export type Seta = z.infer<typeof setaSchema>;

export const fluxoSchema = z.strictObject({
  nos: z.array(noSchema).min(1).max(MAXIMO_DE_NOS),
  setas: z.array(setaSchema).max(MAXIMO_DE_NOS * 4),
});
export type Fluxo = z.infer<typeof fluxoSchema>;

export const configDoChatbotSchema = z.strictObject({
  ativo: z.boolean(),
  fluxo: fluxoSchema,
  /** Resposta a um texto que não é nenhuma das opções; a pergunta é repetida logo abaixo. */
  nao_entendi: textoSchema(500, "Escreva o texto de 'não entendi'"),
  /**
   * O aviso de quando o chatbot passa a conversa para a equipe SEM uma caixa "Passar para a
   * recepção" no caminho: pedido de atendente, três respostas sem entender, falha da agenda.
   */
  recepcao: textoSchema(500, "Escreva o aviso da recepção"),
  /** Depois de quantas horas parado o chatbot recomeça do início. */
  reiniciar_apos_horas: z.number().int().min(1).max(72),
});
export type ConfigDoChatbot = z.infer<typeof configDoChatbotSchema>;

// ─── Saídas de cada caixa ───────────────────────────────────────────────────────────────────

export const SAIDA_SEGUIR = "seguir";
export const SAIDA_MARCOU = "marcou";
export const SAIDA_NAO_MARCOU = "nao_marcou";
export const SAIDA_CONCLUIU = "concluiu";
export const SAIDA_NAO_CONCLUIU = "nao_concluiu";

export interface SaidaDoNo {
  id: string;
  rotulo: string;
}

/** As saídas da caixa, na ordem em que o cartão as desenha. Caixa final não tem saída. */
export function saidasDoNo(no: NoDoFluxo): SaidaDoNo[] {
  switch (no.tipo) {
    case "inicio":
    case "mensagem":
    case "pergunta":
    case "proximos":
      return [{ id: SAIDA_SEGUIR, rotulo: "Depois" }];
    case "menu":
      return no.opcoes.map((o, i) => ({ id: o.id, rotulo: `${i + 1} - ${o.rotulo}` }));
    case "marcar":
      return [
        { id: SAIDA_MARCOU, rotulo: "Marcou" },
        { id: SAIDA_NAO_MARCOU, rotulo: "Não marcou" },
      ];
    case "remarcar_cancelar":
      return [
        { id: SAIDA_CONCLUIU, rotulo: "Resolvido" },
        { id: SAIDA_NAO_CONCLUIU, rotulo: "Não resolveu" },
      ];
    case "recepcao":
    case "fim":
      return [];
  }
}

// ─── Validação do desenho ───────────────────────────────────────────────────────────────────

export interface ProblemaDoFluxo {
  /** A caixa onde está o problema, quando há uma. */
  noId: string | null;
  mensagem: string;
}

/**
 * O que impede salvar um fluxo que o schema aceita: começo único, setas que apontam para caixas
 * e saídas que existem, uma seta por saída, e o começo ligado a alguma coisa.
 */
export function problemasDoFluxo(fluxo: Fluxo): ProblemaDoFluxo[] {
  const problemas: ProblemaDoFluxo[] = [];
  const porId = new Map<string, NoDoFluxo>();
  for (const no of fluxo.nos) {
    if (porId.has(no.id)) problemas.push({ noId: no.id, mensagem: "Duas caixas com o mesmo id." });
    porId.set(no.id, no);
  }

  const inicios = fluxo.nos.filter((n) => n.tipo === "inicio");
  if (inicios.length !== 1) {
    problemas.push({ noId: null, mensagem: "O fluxo precisa de exatamente uma caixa de Início." });
  }

  const ocupadas = new Set<string>();
  const ids = new Set<string>();
  for (const seta of fluxo.setas) {
    if (ids.has(seta.id))
      problemas.push({ noId: seta.origem, mensagem: "Duas setas com o mesmo id." });
    ids.add(seta.id);
    const origem = porId.get(seta.origem);
    if (!origem || !porId.has(seta.destino)) {
      problemas.push({
        noId: origem?.id ?? null,
        mensagem: "Uma seta aponta para uma caixa que não existe.",
      });
      continue;
    }
    if (!saidasDoNo(origem).some((s) => s.id === seta.saida)) {
      problemas.push({
        noId: origem.id,
        mensagem: "Uma seta sai de uma opção que não existe mais.",
      });
      continue;
    }
    const chave = `${seta.origem}:${seta.saida}`;
    if (ocupadas.has(chave)) {
      problemas.push({
        noId: origem.id,
        mensagem: "Uma saída tem mais de uma seta. Deixe só uma.",
      });
    }
    ocupadas.add(chave);
  }

  const inicio = inicios[0];
  if (inicio && !fluxo.setas.some((s) => s.origem === inicio.id)) {
    problemas.push({ noId: inicio.id, mensagem: "Ligue o Início à primeira caixa da conversa." });
  }
  return problemas;
}

/** O destino da seta que sai de `saida` da caixa `noId`, ou `null` (saída solta). */
export function destinoDaSaida(fluxo: Fluxo, noId: string, saida: string): NoDoFluxo | null {
  const seta = fluxo.setas.find((s) => s.origem === noId && s.saida === saida);
  if (!seta) return null;
  return fluxo.nos.find((n) => n.id === seta.destino) ?? null;
}

// ─── O fluxo com que a clínica começa ───────────────────────────────────────────────────────

/** O ponto de partida do construtor: o menu da TOQ montado em caixas, editável por inteiro. */
export const FLUXO_PADRAO: Fluxo = {
  nos: [
    { id: "inicio", tipo: "inicio", posicao: { x: 360, y: 0 } },
    {
      id: "menu",
      tipo: "menu",
      posicao: { x: 300, y: 110 },
      texto: "Olá! Aqui é a TOQ - Clínica do Movimento. Como posso ajudar?",
      opcoes: [
        { id: "op1", rotulo: "Marcar um horário" },
        { id: "op2", rotulo: "Ver meus próximos horários" },
        { id: "op3", rotulo: "Remarcar ou cancelar" },
        { id: "op4", rotulo: "Falar com a recepção" },
      ],
    },
    { id: "marcar", tipo: "marcar", posicao: { x: 0, y: 420 }, tipo_id: null },
    { id: "proximos", tipo: "proximos", posicao: { x: 260, y: 420 } },
    { id: "remarcar", tipo: "remarcar_cancelar", posicao: { x: 520, y: 420 } },
    {
      id: "recepcao",
      tipo: "recepcao",
      posicao: { x: 780, y: 420 },
      texto: "Certo! Vou chamar alguém da recepção, que já te responde por aqui.",
    },
    {
      id: "fim",
      tipo: "fim",
      posicao: { x: 260, y: 640 },
      texto: "Obrigado! Se precisar de mais alguma coisa, é só mandar uma mensagem.",
    },
  ],
  setas: [
    { id: "s1", origem: "inicio", saida: SAIDA_SEGUIR, destino: "menu" },
    { id: "s2", origem: "menu", saida: "op1", destino: "marcar" },
    { id: "s3", origem: "menu", saida: "op2", destino: "proximos" },
    { id: "s4", origem: "menu", saida: "op3", destino: "remarcar" },
    { id: "s5", origem: "menu", saida: "op4", destino: "recepcao" },
    { id: "s6", origem: "marcar", saida: SAIDA_MARCOU, destino: "fim" },
    { id: "s7", origem: "marcar", saida: SAIDA_NAO_MARCOU, destino: "recepcao" },
    { id: "s8", origem: "proximos", saida: SAIDA_SEGUIR, destino: "fim" },
    { id: "s9", origem: "remarcar", saida: SAIDA_CONCLUIU, destino: "fim" },
    { id: "s10", origem: "remarcar", saida: SAIDA_NAO_CONCLUIU, destino: "recepcao" },
  ],
};

export const CONFIG_PADRAO: ConfigDoChatbot = {
  ativo: false,
  fluxo: FLUXO_PADRAO,
  nao_entendi: "Não entendi. Responda só com o número de uma das opções.",
  recepcao: "Certo! Vou chamar alguém da recepção, que já te responde por aqui.",
  reiniciar_apos_horas: 12,
};

/**
 * A configuração gravada no `metadata` da conexão, ou `null` quando não há (ou está quebrada).
 * Nunca lança: um jsonb malformado deixa o chatbot DESLIGADO, e a conexão segue como estava.
 */
export function configDoMetadata(metadata: unknown): ConfigDoChatbot | null {
  if (metadata === null || typeof metadata !== "object") return null;
  const bruto = (metadata as Record<string, unknown>)[CHAVE_NO_METADATA];
  if (bruto === undefined) return null;
  const lido = configDoChatbotSchema.safeParse(bruto);
  if (!lido.success || problemasDoFluxo(lido.data.fluxo).length > 0) return null;
  return lido.data;
}

/** O chatbot responde nesta conexão? (configuração válida E ligada) */
export function chatbotLigado(metadata: unknown): boolean {
  return configDoMetadata(metadata)?.ativo === true;
}
