/**
 * Os pacotes na ficha do paciente: as contas da TELA, sem React (módulo clínica).
 *
 * As do pacote em si (saldo, situação, reembolso) moram em `./pacotes` e chegam prontas da rota;
 * aqui fica só o que a ficha decide: o que está valendo, o que já passou, o que se pode vender e
 * qual ajuste cabe a quem.
 */
import type { Modalidade } from "./vocabulario";
import { MODALIDADES } from "./vocabulario";
import type { SituacaoDoPacote } from "./pacotes";

/** O pacote como `GET /api/v1/clinica/pacotes` devolve. */
export interface PacoteDaFicha {
  id: string;
  contact_id: string;
  produto_id: string | null;
  nome: string;
  modalidade: Modalidade;
  sessoes_total: number;
  sessoes_usadas: number;
  saldo: number;
  situacao: SituacaoDoPacote;
  precisa_renovar: boolean;
  valor_cents: number | null;
  currency: string;
  comprado_em: string;
  valido_ate: string;
  status: "ativo" | "cancelado";
  congelado_em: string | null;
  congelado_dias: number | null;
  cancelado_em: string | null;
  cancelamento_motivo: string | null;
}

/** O item do catálogo como `GET /api/v1/clinica/produtos` devolve. */
export interface ProdutoDoCatalogo {
  id: string;
  nome: string;
  modalidade: Modalidade;
  sessoes: number;
  validade_dias: number;
  valor_cents: number | null;
  currency: string;
  ativo: boolean;
}

/** Valendo em cima, o resto embaixo; a rota já manda os mais novos primeiro. */
export function separarPacotes(pacotes: PacoteDaFicha[]): {
  vigentes: PacoteDaFicha[];
  anteriores: PacoteDaFicha[];
} {
  return {
    vigentes: pacotes.filter((p) => p.situacao === "ativo"),
    anteriores: pacotes.filter((p) => p.situacao !== "ativo"),
  };
}

/**
 * O que se pode vender: o catálogo à venda e, para cada modalidade, o pacote padrão das Regras
 * da clínica. A TOQ ainda não fechou serviços e preços, então o catálogo pode estar vazio, e a
 * recepção precisa conseguir vender mesmo assim.
 */
export type OpcaoDeVenda =
  | { chave: string; tipo: "produto"; produto: ProdutoDoCatalogo }
  | { chave: string; tipo: "padrao"; modalidade: Modalidade };

export function opcoesDeVenda(produtos: ProdutoDoCatalogo[]): OpcaoDeVenda[] {
  return [
    ...produtos
      .filter((p) => p.ativo)
      .map((p) => ({ chave: `produto:${p.id}`, tipo: "produto" as const, produto: p })),
    ...MODALIDADES.map((m) => ({ chave: `padrao:${m}`, tipo: "padrao" as const, modalidade: m })),
  ];
}

/** O corpo do `POST /api/v1/clinica/pacotes` para a opção escolhida. */
export function corpoDaVenda(
  contactId: string,
  opcao: OpcaoDeVenda,
  valorCents: number | null,
): Record<string, unknown> {
  if (opcao.tipo === "produto") {
    return { contact_id: contactId, produto_id: opcao.produto.id, aceite_politica: true };
  }
  return {
    contact_id: contactId,
    modalidade: opcao.modalidade,
    ...(valorCents !== null ? { valor_cents: valorCents } : {}),
    aceite_politica: true,
  };
}

/** Até quando o congelamento segura o pacote, ou `null` quando ele nunca foi congelado. */
export function congeladoAte(
  p: Pick<PacoteDaFicha, "congelado_em" | "congelado_dias">,
): Date | null {
  if (!p.congelado_em || !p.congelado_dias) return null;
  return new Date(new Date(p.congelado_em).getTime() + p.congelado_dias * 86_400_000);
}

export type AjusteDoPacote = "congelar" | "prorrogar" | "cancelar";

/**
 * Os ajustes que a tela oferece. Congelar é da recepção, uma vez por pacote e só no que está
 * valendo; prorrogar e cancelar são da gerência. A rota decide de novo: isto só evita mostrar
 * um botão que daria erro.
 */
export function ajustesPermitidos(p: PacoteDaFicha, gerencia: boolean): AjusteDoPacote[] {
  if (p.status === "cancelado") return [];
  const ajustes: AjusteDoPacote[] = [];
  if (p.situacao === "ativo" && !p.congelado_em) ajustes.push("congelar");
  // Prorrogar pacote sem saldo não devolve sessão nenhuma; cancelar só o que está valendo,
  // porque sessão vencida não é devolvida e o pacote esgotado não tem o que reembolsar.
  if (gerencia && p.saldo > 0) ajustes.push("prorrogar");
  if (gerencia && p.situacao === "ativo") ajustes.push("cancelar");
  return ajustes;
}
