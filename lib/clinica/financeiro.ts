/**
 * O PAINEL FINANCEIRO da clínica (módulo clínica, migration 9012): o que entrou, o que saiu e o
 * que ainda falta cobrar dos pacientes no período.
 *
 * Pedido do Pedro (2026-10-15): "Pra galera que tem acesso ao financeiro, eu preciso que eles
 * tenham acesso à um cockpit de entradas e saídas, pra eles saberem oq ainda precisa cobrar do
 * cliente, oq já entrou, etc…".
 *
 *  - Entrada = pagamento registrado (`clinica_pagamentos`, migration 9011) no período.
 *  - Saída = despesa registrada à mão (`clinica_despesas`, migration 9012) no período.
 *  - A receber = pacote ativo, sessão avulsa realizada e multa pendente do período ainda sem
 *    pagamento. A conta é do banco (`fn_clinica_financeiro_*`); este arquivo só tipa e rotula.
 *
 * Quem vê e quem registra despesa: Administrador, Gerente e Financeiro, a mesma régua do
 * relatório da gestão (`veRelatoriosDaGestao`, servidor em `recusaDoRelatorio`).
 */
import { z } from "zod";

import { ROTULO_DA_FORMA, type FormaDePagamento } from "./pagamentos";

export const CATEGORIAS_DE_DESPESA = [
  "aluguel",
  "pessoal",
  "materiais",
  "impostos",
  "contas",
  "marketing",
  "manutencao",
  "servicos",
  "outros",
] as const;
export type CategoriaDeDespesa = (typeof CATEGORIAS_DE_DESPESA)[number];

export const ROTULO_DA_CATEGORIA: Record<CategoriaDeDespesa, string> = {
  aluguel: "Aluguel",
  pessoal: "Salários e pessoal",
  materiais: "Materiais e equipamentos",
  impostos: "Impostos e taxas",
  contas: "Água, luz e internet",
  marketing: "Marketing",
  manutencao: "Manutenção",
  servicos: "Serviços contratados",
  outros: "Outros",
};

/** As formas de uma SAÍDA: as do pagamento do paciente, mais boleto e transferência. */
export const FORMAS_DE_SAIDA = [
  "pix",
  "cartao_credito",
  "cartao_debito",
  "dinheiro",
  "boleto",
  "transferencia",
] as const;
export type FormaDeSaida = (typeof FORMAS_DE_SAIDA)[number];

export const ROTULO_DA_FORMA_DE_SAIDA: Record<FormaDeSaida, string> = {
  ...ROTULO_DA_FORMA,
  boleto: "Boleto",
  transferencia: "Transferência",
};

/** O que foi pago ou está a receber: um pacote, uma sessão avulsa ou uma multa. */
export type TipoDoItem = "pacote" | "sessao" | "multa";

export const ROTULO_DO_TIPO: Record<TipoDoItem, string> = {
  pacote: "Pacotes",
  sessao: "Sessões avulsas",
  multa: "Multas",
};

export const RECUSA_DO_FINANCEIRO =
  "O painel financeiro é do Administrador, do Gerente e do Financeiro.";

// ── o que a rota devolve ──────────────────────────────────────────────────────────────────────

export interface ResumoFinanceiro {
  entradas: {
    qtd: number;
    total_cents: number;
    sem_valor: number;
    por_forma: { forma: FormaDePagamento; qtd: number; valor_cents: number }[];
    por_tipo: { tipo: TipoDoItem; qtd: number; valor_cents: number }[];
  };
  saidas: {
    qtd: number;
    total_cents: number;
    por_categoria: { categoria: CategoriaDeDespesa; qtd: number; valor_cents: number }[];
  };
  a_receber: {
    qtd: number;
    total_cents: number;
    sem_valor: number;
    por_tipo: { tipo: TipoDoItem; qtd: number; valor_cents: number }[];
  };
  /** Sessões marcadas de agora até o fim do período que um pacote não vai cobrir. */
  previsao: {
    qtd: number;
    total_cents: number;
    sem_valor: number;
    cobertas_por_pacote: number;
  };
}

interface Contato {
  contact_id: string | null;
  contato_name: string | null;
  contato_display_name: string | null;
  contato_phone: string | null;
}

export interface EntradaFinanceira extends Contato {
  id: string;
  pago_em: string;
  tipo: TipoDoItem;
  descricao: string | null;
  referente_em: string | null;
  forma: FormaDePagamento;
  valor_cents: number | null;
  currency: string;
}

export interface ItemAReceber extends Contato {
  tipo: TipoDoItem;
  id: string;
  desde: string;
  descricao: string | null;
  valor_cents: number | null;
  currency: string;
}

/** Um compromisso marcado: entra pelo preço de tabela, ou não entra se um pacote o cobre. */
export interface ItemPrevisto extends Contato {
  id: string;
  starts_at: string;
  descricao: string | null;
  coberta_por_pacote: boolean;
  valor_cents: number | null;
  currency: string;
}

export interface Despesa {
  id: string;
  descricao: string;
  categoria: CategoriaDeDespesa;
  forma: FormaDeSaida;
  valor_cents: number;
  currency: string;
  pago_em: string;
}

/** GET /api/v1/clinica/financeiro. */
export interface PainelFinanceiro {
  periodo: { de: string; ate: string };
  resumo: ResumoFinanceiro;
  entradas: EntradaFinanceira[];
  a_receber: ItemAReceber[];
  previsao: ItemPrevisto[];
  saidas: Despesa[];
  /** A lista passou do teto da tela; a planilha traz tudo. */
  cortado: { entradas: boolean; a_receber: boolean; previsao: boolean; saidas: boolean };
}

/** Quanto sobrou: entradas menos saídas. */
export function saldoDo(resumo: ResumoFinanceiro): number {
  return resumo.entradas.total_cents - resumo.saidas.total_cents;
}

// ── entrada pela rota ─────────────────────────────────────────────────────────────────────────

const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use a data no formato AAAA-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "data inválida");

/** POST /api/v1/clinica/despesas. */
export const registrarDespesaSchema = z
  .object({
    descricao: z
      .string()
      .trim()
      .min(2, "Diga o que foi pago.")
      .max(160, "Descrição longa demais (até 160 letras)."),
    categoria: z.enum(CATEGORIAS_DE_DESPESA, { message: "Escolha a categoria." }),
    forma: z.enum(FORMAS_DE_SAIDA, { message: "Escolha a forma de pagamento." }),
    valor_cents: z
      .number({ message: "Diga o valor." })
      .int()
      .min(1, "O valor tem de ser maior que zero.")
      .max(100_000_000),
    /** O dia em que saiu do caixa. */
    dia,
  })
  .strict();
export type RegistrarDespesa = z.infer<typeof registrarDespesaSchema>;

/**
 * O dia civil vira meio-dia de Brasília: longe da meia-noite, o filtro do período (que começa à
 * 0h de Brasília) nunca empurra a despesa para o dia vizinho.
 */
export function diaParaInstante(diaCivil: string): string {
  return new Date(`${diaCivil}T12:00:00-03:00`).toISOString();
}

/** O último dia do mês de `dia` (`AAAA-MM-DD`): o fim do "Este mês" do painel. */
export function fimDoMes(dia: string): string {
  const d = new Date(`${dia.slice(0, 8)}01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export const TIPOS_DE_EXPORTACAO_FINANCEIRA = [
  "entradas",
  "saidas",
  "a_receber",
  "previsao",
] as const;
export type TipoDeExportacaoFinanceira = (typeof TIPOS_DE_EXPORTACAO_FINANCEIRA)[number];

/** O nome do arquivo: `clinica-financeiro-entradas-2026-10-01-a-2026-10-31.csv`. */
export function nomeDoArquivoFinanceiro(
  tipo: TipoDeExportacaoFinanceira,
  de: string,
  ate: string,
): string {
  return `clinica-financeiro-${tipo.replace("_", "-")}-${de}-a-${ate}.csv`;
}
