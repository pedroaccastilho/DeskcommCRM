/**
 * O RELATÓRIO DA GESTÃO e a exportação para a contabilidade (módulo clínica, migration 9009).
 *
 * Pedido do Pedro (2026-10-04): o gerente acompanha como a clínica está andando e exporta o
 * período para um financeiro externo. A conta é do banco (`fn_clinica_relatorio_gestao`); este
 * arquivo só tem o contrato da resposta e as contas puras do CSV.
 *
 * O CSV segue o padrão que o Excel e os sistemas de contabilidade do Brasil abrem sem pergunta:
 * separador `;`, vírgula decimal sem separador de milhar (`1500,00`), data `dd/mm/aaaa` no fuso
 * de Brasília, BOM UTF-8 no começo (senão o Excel lê os acentos como Latin-1) e linhas em CRLF.
 */

export interface ContagemDeSessoes {
  marcadas: number;
  realizadas: number;
  faltas: number;
  canceladas: number;
}

export interface RelatorioDaGestao {
  periodo: { de: string; ate: string };
  sessoes: ContagemDeSessoes & {
    em_aberto: number;
    pacientes_atendidos: number;
    avulsas_realizadas: number;
    avulsas_valor_tabela_cents: number;
    avulsas_sem_preco: number;
  };
  por_modalidade: (ContagemDeSessoes & { modalidade: string })[];
  por_profissional: (ContagemDeSessoes & {
    user_id: string | null;
    nome: string | null;
    pacientes: number;
  })[];
  pacotes: {
    vendidos: number;
    vendidos_valor_cents: number;
    vendidos_sem_valor: number;
    por_modalidade: {
      modalidade: string;
      vendidos: number;
      valor_cents: number;
      sem_valor: number;
    }[];
    cancelados: number;
    cancelados_valor_cents: number;
    reembolso_sugerido_cents: number;
  };
  multas: {
    geradas: number;
    geradas_valor_cents: number;
    pendentes: number;
    pendentes_valor_cents: number;
    pagas: number;
    pagas_valor_cents: number;
    isentas: number;
    isentas_valor_cents: number;
  };
  pacientes_novos: number;
}

/** Taxa de faltas sobre as sessões que já tiveram desfecho (realizadas + faltas), em %. */
export function taxaDeFaltas(c: Pick<ContagemDeSessoes, "realizadas" | "faltas">): number | null {
  const base = c.realizadas + c.faltas;
  if (base === 0) return null;
  return Math.round((c.faltas / base) * 100);
}

export const TIPOS_DE_EXPORTACAO = ["resumo", "sessoes", "pacotes", "multas"] as const;
export type TipoDeExportacao = (typeof TIPOS_DE_EXPORTACAO)[number];

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────

export type CelulaCsv = string | number | null | undefined;

/** Uma célula: entre aspas só quando precisa (`;`, aspas, quebra de linha ou espaço nas pontas). */
function celula(valor: CelulaCsv): string {
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  // Fórmula injetada numa planilha (`=`, `+`, `-`, `@` no começo) vira texto com um apóstrofo.
  // Número negativo é dado, não fórmula: só o texto passa por aqui com esse risco.
  const seguro = typeof valor === "string" && /^[=+\-@\t\r]/.test(texto) ? `'${texto}` : texto;
  return /[";\r\n]|^\s|\s$/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** O arquivo CSV inteiro, com BOM e CRLF. */
export function csvBr(cabecalho: readonly string[], linhas: readonly CelulaCsv[][]): string {
  const todas = [cabecalho, ...linhas].map((l) => l.map(celula).join(";"));
  return `﻿${todas.join("\r\n")}\r\n`;
}

/** Centavos como a contabilidade lê: `1500,00`, `-12,50`; vazio quando não há valor. */
export function dinheiroBr(centavos: number | null | undefined): string {
  if (centavos === null || centavos === undefined) return "";
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(centavos));
  return `${sinal}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

const FUSO = "America/Sao_Paulo";

/**
 * `dd/mm/aaaa` no fuso da clínica; vazio sem data. O formato é o CONTRATO da planilha (a
 * contabilidade importa `dd/mm/aaaa` qualquer que seja o idioma da tela), então não sai de uma
 * localidade: a data civil vem em ISO (`en-CA` dá `AAAA-MM-DD`) e é remontada aqui.
 */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "";
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date(iso));
  return dataDeDia(dia);
}

/** `HH:MM` (24 h) no fuso da clínica; vazio sem data. */
export function horaBr(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** O nome do arquivo: `clinica-sessoes-2026-09-01-a-2026-09-30.csv`. */
export function nomeDoArquivo(tipo: TipoDeExportacao, de: string, ate: string): string {
  return `clinica-${tipo}-${de}-a-${ate}.csv`;
}

const ROTULO_DA_SITUACAO_DA_SESSAO: Record<string, string> = {
  pending: "A confirmar",
  confirmed: "Confirmada",
  completed: "Realizada",
  no_show: "Falta",
  cancelled: "Cancelada",
};

export function situacaoDaSessao(status: string): string {
  return ROTULO_DA_SITUACAO_DA_SESSAO[status] ?? status;
}

const ROTULO_DA_MODALIDADE: Record<string, string> = {
  fisioterapia: "Fisioterapia",
  pilates: "Pilates",
  medicina: "Medicina",
  enfermagem: "Enfermagem",
};

export function modalidadeBr(modalidade: string | null | undefined): string {
  if (!modalidade) return "";
  return ROTULO_DA_MODALIDADE[modalidade] ?? modalidade;
}

/** O resumo do período em linhas "Indicador; Quantidade; Valor (R$)", para a contabilidade. */
export function linhasDoResumo(r: RelatorioDaGestao): CelulaCsv[][] {
  const s = r.sessoes;
  const p = r.pacotes;
  const m = r.multas;
  const linhas: CelulaCsv[][] = [
    ["Período", `${dataDeDia(r.periodo.de)} a ${dataDeDia(r.periodo.ate)}`, ""],
    ["Pacotes vendidos", p.vendidos, dinheiroBr(p.vendidos_valor_cents)],
    ...p.por_modalidade.map((pm): CelulaCsv[] => [
      `Pacotes vendidos: ${modalidadeBr(pm.modalidade)}`,
      pm.vendidos,
      dinheiroBr(pm.valor_cents),
    ]),
    ["Pacotes vendidos sem valor cadastrado", p.vendidos_sem_valor, ""],
    ["Pacotes cancelados", p.cancelados, dinheiroBr(p.cancelados_valor_cents)],
    ["Reembolso sugerido dos cancelados", "", dinheiroBr(p.reembolso_sugerido_cents)],
    ["Multas geradas", m.geradas, dinheiroBr(m.geradas_valor_cents)],
    ["Multas pagas", m.pagas, dinheiroBr(m.pagas_valor_cents)],
    ["Multas pendentes", m.pendentes, dinheiroBr(m.pendentes_valor_cents)],
    ["Multas isentas", m.isentas, dinheiroBr(m.isentas_valor_cents)],
    ["Sessões marcadas", s.marcadas, ""],
    ["Sessões realizadas", s.realizadas, ""],
    ["Faltas", s.faltas, ""],
    ["Sessões canceladas", s.canceladas, ""],
    [
      "Sessões avulsas realizadas (preço de tabela, não é recebimento)",
      s.avulsas_realizadas,
      dinheiroBr(s.avulsas_valor_tabela_cents),
    ],
    ["Pacientes atendidos", s.pacientes_atendidos, ""],
    ["Pacientes novos", r.pacientes_novos, ""],
  ];
  return linhas;
}

/** `AAAA-MM-DD` (dia civil, sem fuso) → `dd/mm/aaaa`. */
export function dataDeDia(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Quem vê o relatório da gestão e exporta: Administrador, Gerente e Financeiro (Pedro,
 * 2026-10-04). O Jurídico também tem o degrau `manager` no núcleo, mas não vê valor vendido: a
 * soma fina dos perfis é decidida aqui, não pelo papel.
 */
export function veRelatoriosDaGestao(role: string, cargos: readonly string[]): boolean {
  if (role === "admin") return true;
  // A rota exige o degrau `manager`; sem ele o menu não mostra uma porta que daria 403.
  if (role !== "manager") return false;
  return cargos.some((c) => c === "administrador" || c === "gerente" || c === "financeiro");
}
