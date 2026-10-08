/**
 * A AGENDA da interface nova em três visões, como a da versão atual: Dia (uma coluna por
 * profissional), Semana (uma coluna por dia) e Mês (o calendário). Aqui ficam as contas puras:
 * que dias cada visão cobre, para onde as setas levam e como encaixar lado a lado as sessões que
 * se sobrepõem no mesmo dia. A rede e o desenho ficam na tela (`app/(nova)/agenda`).
 *
 * Os dias são datas de parede (`AAAA-MM-DD`), sem fuso: o fuso da organização entra só na hora
 * de dizer em que dia uma sessão cai.
 */

export type VisaoDaAgenda = "dia" | "semana" | "mes";

export const VISOES_DA_AGENDA: readonly VisaoDaAgenda[] = ["dia", "semana", "mes"];

function partes(dia: string): [number, number, number] {
  return dia.split("-").map(Number) as [number, number, number];
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Soma dias a `AAAA-MM-DD`. */
export function somarDiasDeParede(dia: string, n: number): string {
  const [a, m, d] = partes(dia);
  return iso(new Date(Date.UTC(a, m - 1, d + n, 12)));
}

/** 0 = segunda … 6 = domingo (a semana da clínica começa na segunda). */
export function diaDaSemana(dia: string): number {
  const [a, m, d] = partes(dia);
  return (new Date(Date.UTC(a, m - 1, d, 12)).getUTCDay() + 6) % 7;
}

/**
 * Os dias que a visão mostra. A Semana vai de segunda a domingo; o Mês, do dia 1 ao último dia
 * do mês (no máximo 31, o que a grade da clínica aceita num pedido só).
 */
export function diasDaVisao(visao: VisaoDaAgenda, dia: string): string[] {
  if (visao === "dia") return [dia];
  if (visao === "semana") {
    const segunda = somarDiasDeParede(dia, -diaDaSemana(dia));
    return Array.from({ length: 7 }, (_, i) => somarDiasDeParede(segunda, i));
  }
  const [a, m] = partes(dia);
  const ultimo = new Date(Date.UTC(a, m, 0, 12)).getUTCDate();
  return Array.from({ length: ultimo }, (_, i) => iso(new Date(Date.UTC(a, m - 1, i + 1, 12))));
}

/**
 * Para onde as setas levam: um dia, uma semana ou um mês. No Mês, o dia fica no 1º para não
 * pular meses curtos (31 de janeiro + 1 mês não pode cair em março).
 */
export function andar(visao: VisaoDaAgenda, dia: string, sentido: 1 | -1): string {
  if (visao === "dia") return somarDiasDeParede(dia, sentido);
  if (visao === "semana") return somarDiasDeParede(dia, 7 * sentido);
  const [a, m] = partes(dia);
  return iso(new Date(Date.UTC(a, m - 1 + sentido, 1, 12)));
}

/**
 * Sessões que se sobrepõem no mesmo dia dividem a largura: cada uma recebe uma faixa e quantas
 * faixas o grupo dela tem. Grupo = sessões ligadas por sobreposição, em ordem de início.
 */
export function faixasLadoALado(
  sessoes: ReadonlyArray<{ id: string; inicio: number; fim: number }>,
): Map<string, { faixa: number; faixas: number }> {
  const ordem = [...sessoes].sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);
  const saida = new Map<string, { faixa: number; faixas: number }>();
  let grupo: { id: string; faixa: number }[] = [];
  let fimDasFaixas: number[] = [];
  let fimDoGrupo = -Infinity;
  const fecharGrupo = () => {
    for (const g of grupo) saida.set(g.id, { faixa: g.faixa, faixas: fimDasFaixas.length });
    grupo = [];
    fimDasFaixas = [];
  };
  for (const s of ordem) {
    if (s.inicio >= fimDoGrupo) fecharGrupo();
    let faixa = fimDasFaixas.findIndex((fim) => fim <= s.inicio);
    if (faixa === -1) {
      faixa = fimDasFaixas.length;
      fimDasFaixas.push(s.fim);
    } else {
      fimDasFaixas[faixa] = s.fim;
    }
    grupo.push({ id: s.id, faixa });
    fimDoGrupo = Math.max(fimDoGrupo, s.fim);
  }
  fecharGrupo();
  return saida;
}
