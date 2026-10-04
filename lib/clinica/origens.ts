/**
 * ORIGEM DO PACIENTE — vocabulário e contas puras (módulo clínica, migration 9005).
 *
 * Por onde o paciente chegou: WhatsApp, Instagram (influenciador ou anúncio), indicação (de qual
 * paciente), encaminhamento médico (de qual médico) ou outra. A LISTA é da clínica (o
 * administrador renomeia, acrescenta, desliga); o TIPO de cada origem é deste módulo e diz o que
 * a recepção precisa contar. `TIPOS_DE_ORIGEM` espelha o CHECK de `clinica_origens.tipo`.
 */

export const TIPOS_DE_ORIGEM = [
  "whatsapp",
  "instagram",
  "indicacao",
  "encaminhamento",
  "outro",
] as const;
export type TipoDeOrigem = (typeof TIPOS_DE_ORIGEM)[number];

export const ROTULO_DO_TIPO_DE_ORIGEM: Record<TipoDeOrigem, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  indicacao: "Indicação de paciente",
  encaminhamento: "Encaminhamento médico",
  outro: "Outra",
};

/** O que a recepção precisa informar além da origem. */
export type ComplementoDaOrigem = "detalhe" | "indicado_por" | null;

export const COMPLEMENTO_DO_TIPO: Record<TipoDeOrigem, ComplementoDaOrigem> = {
  whatsapp: null,
  instagram: "detalhe",
  indicacao: "indicado_por",
  encaminhamento: "detalhe",
  outro: null,
};

/** A pergunta que a tela faz no campo de detalhe, por tipo. */
export const PERGUNTA_DO_DETALHE: Record<TipoDeOrigem, string | null> = {
  whatsapp: null,
  instagram: "Qual influenciador ou anúncio?",
  indicacao: null,
  encaminhamento: "Qual médico encaminhou?",
  outro: "Detalhe (opcional)",
};

/** A lista com que toda clínica começa, na primeira leitura. O administrador muda depois. */
export const ORIGENS_PADRAO: ReadonlyArray<{ nome: string; tipo: TipoDeOrigem; ordem: number }> = [
  { nome: "WhatsApp", tipo: "whatsapp", ordem: 10 },
  { nome: "Instagram: influenciador", tipo: "instagram", ordem: 20 },
  { nome: "Instagram: anúncio pago", tipo: "instagram", ordem: 30 },
  { nome: "Indicação de paciente", tipo: "indicacao", ordem: 40 },
  { nome: "Encaminhamento médico", tipo: "encaminhamento", ordem: 50 },
  { nome: "Outra", tipo: "outro", ordem: 60 },
];

export interface OrigemDaClinica {
  id: string;
  nome: string;
  tipo: TipoDeOrigem;
  ativo: boolean;
  ordem: number;
}

/**
 * Por que a origem informada não pode ser gravada, em linguagem da recepção, ou `null`.
 * Instagram e encaminhamento pedem o detalhe; indicação pede quem indicou; ninguém indica a si.
 */
export function recusaDaOrigemDoPaciente(
  tipo: TipoDeOrigem,
  dados: { detalhe?: string | null; indicado_por_contact_id?: string | null },
  contactId: string,
): string | null {
  const complemento = COMPLEMENTO_DO_TIPO[tipo];
  const detalhe = dados.detalhe?.trim() ?? "";
  if (complemento === "detalhe" && detalhe === "") {
    return tipo === "encaminhamento"
      ? "Informe qual médico encaminhou o paciente."
      : "Informe qual influenciador ou anúncio trouxe o paciente.";
  }
  if (complemento === "indicado_por" && !dados.indicado_por_contact_id) {
    return "Informe qual paciente fez a indicação.";
  }
  if (dados.indicado_por_contact_id && dados.indicado_por_contact_id === contactId) {
    return "O paciente não pode indicar a si mesmo.";
  }
  return null;
}

/** Uma linha de `fn_clinica_relatorio_origens`: origem efetiva × detalhe × automática. */
export interface LinhaDoRelatorioDeOrigens {
  origem_id: string | null;
  detalhe: string | null;
  automatica: boolean;
  novos: number | string;
  com_pacote: number | string;
  pacotes: number | string;
  pacotes_valor_cents: number | string;
}

export interface Contagem {
  novos: number;
  com_pacote: number;
  pacotes: number;
  pacotes_valor_cents: number;
  /** Quantos dos novos compraram pacote, em % inteiro. `null` sem novos. */
  conversao_pct: number | null;
}

export interface LinhaPorOrigem extends Contagem {
  origem_id: string | null;
  nome: string;
  tipo: TipoDeOrigem | null;
  /** Quantos entraram como WhatsApp sem a recepção registrar (calculado de `contacts.source`). */
  automaticos: number;
  /** Por influenciador, anúncio ou médico, do que mais trouxe ao que menos trouxe. */
  detalhes: Array<{ detalhe: string } & Contagem>;
}

export interface RelatorioDeOrigens {
  origens: LinhaPorOrigem[];
  total: Contagem;
}

function contagem(novos: number, comPacote: number, pacotes: number, valor: number): Contagem {
  return {
    novos,
    com_pacote: comPacote,
    pacotes,
    pacotes_valor_cents: valor,
    conversao_pct: novos > 0 ? Math.round((comPacote / novos) * 100) : null,
  };
}

/**
 * Junta as linhas do banco por origem, com o detalhe por baixo, na ordem da lista da clínica.
 * Origem da lista sem paciente no período aparece zerada (a recepção vê o canal que não trouxe
 * ninguém); "Sem origem registrada" fica por último e só aparece quando tem alguém.
 */
export function consolidarRelatorio(
  linhas: readonly LinhaDoRelatorioDeOrigens[],
  origens: readonly OrigemDaClinica[],
): RelatorioDeOrigens {
  type Acumulado = {
    novos: number;
    com: number;
    pacotes: number;
    valor: number;
    auto: number;
    detalhes: Map<string, { novos: number; com: number; pacotes: number; valor: number }>;
  };
  const vazio = (): Acumulado => ({
    novos: 0,
    com: 0,
    pacotes: 0,
    valor: 0,
    auto: 0,
    detalhes: new Map(),
  });
  const porOrigem = new Map<string | null, Acumulado>();

  for (const l of linhas) {
    const novos = Number(l.novos);
    const com = Number(l.com_pacote);
    const pacotes = Number(l.pacotes);
    const valor = Number(l.pacotes_valor_cents);
    const a = porOrigem.get(l.origem_id) ?? vazio();
    a.novos += novos;
    a.com += com;
    a.pacotes += pacotes;
    a.valor += valor;
    if (l.automatica) a.auto += novos;
    const chave = l.detalhe?.trim();
    if (chave) {
      const d = a.detalhes.get(chave) ?? { novos: 0, com: 0, pacotes: 0, valor: 0 };
      d.novos += novos;
      d.com += com;
      d.pacotes += pacotes;
      d.valor += valor;
      a.detalhes.set(chave, d);
    }
    porOrigem.set(l.origem_id, a);
  }

  const linhaDe = (
    origemId: string | null,
    nome: string,
    tipo: TipoDeOrigem | null,
    a: Acumulado,
  ): LinhaPorOrigem => ({
    origem_id: origemId,
    nome,
    tipo,
    automaticos: a.auto,
    ...contagem(a.novos, a.com, a.pacotes, a.valor),
    detalhes: [...a.detalhes.entries()]
      .map(([detalhe, d]) => ({ detalhe, ...contagem(d.novos, d.com, d.pacotes, d.valor) }))
      .sort((x, y) => y.novos - x.novos || x.detalhe.localeCompare(y.detalhe, "pt-BR")),
  });

  const ordenadas = [...origens].sort(
    (x, y) => x.ordem - y.ordem || x.nome.localeCompare(y.nome, "pt-BR"),
  );
  const resultado: LinhaPorOrigem[] = [];
  for (const o of ordenadas) {
    const a = porOrigem.get(o.id);
    // Origem desligada só aparece se trouxe alguém no período.
    if (!a && !o.ativo) continue;
    resultado.push(linhaDe(o.id, o.nome, o.tipo, a ?? vazio()));
  }
  const sem = porOrigem.get(null);
  if (sem && sem.novos > 0) resultado.push(linhaDe(null, "Sem origem registrada", null, sem));

  const soma = resultado.reduce(
    (t, l) => ({
      novos: t.novos + l.novos,
      com: t.com + l.com_pacote,
      pacotes: t.pacotes + l.pacotes,
      valor: t.valor + l.pacotes_valor_cents,
    }),
    { novos: 0, com: 0, pacotes: 0, valor: 0 },
  );
  return { origens: resultado, total: contagem(soma.novos, soma.com, soma.pacotes, soma.valor) };
}

const FUSO_DA_CLINICA = "-03:00"; // America/Sao_Paulo, sem horário de verão desde 2019.

/**
 * O período do relatório em instantes: `de` e `ate` são dias (AAAA-MM-DD, horário de Brasília),
 * `ate` inclusive. Sem eles, o mês corrente até hoje.
 */
export function periodoDoRelatorio(
  de: string | undefined,
  ate: string | undefined,
  agora: Date = new Date(),
): { de: string; ate: string; inicio: Date; fim: Date } {
  const hoje = new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  const dia = de ?? `${hoje.slice(0, 8)}01`;
  const ultimo = ate ?? hoje;
  const inicio = new Date(`${dia}T00:00:00${FUSO_DA_CLINICA}`);
  const fim = new Date(new Date(`${ultimo}T00:00:00${FUSO_DA_CLINICA}`).getTime() + 86_400_000);
  return { de: dia, ate: ultimo, inicio, fim };
}
