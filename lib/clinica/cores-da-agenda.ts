/**
 * A COR DE MODALIDADE na grade da Agenda — o lado do módulo clínica.
 *
 * Numa clínica, o que a recepção lê primeiro na grade é O QUE está acontecendo
 * (fisio, pilates, consulta, enfermagem), não quem atende. A grade do núcleo
 * pinta por pessoa; este módulo oferece a outra leitura, e a Agenda só a usa
 * quando o módulo está instalado e a pessoa escolhe "Cores: modalidade".
 *
 * ─── Por que a modalidade sai do NOME do tipo ────────────────────────────
 *
 * `calendar_event_types` não tem coluna de modalidade, e a coluna `color` que
 * existiu saiu na 0185 (ver o apêndice do baseline: "se voltar um dia, volta
 * como trilha, com alternador"). Guardar o vínculo tipo → modalidade é dado do
 * módulo e fica para a tabela dele; até lá, o nome que a clínica deu ao tipo
 * ("Sessão de fisioterapia", "Aula de pilates") já diz a modalidade. O que não
 * casar cai em `null` e é pintado neutro — nunca com a cor de outra modalidade.
 *
 * A cor em si mora no `globals.css` (`--agenda-modalidade-*`, nos três blocos
 * de tema); aqui só se aponta para ela, como em `components/agenda/paleta.ts`.
 */
import { MODALIDADES, type Modalidade } from "./vocabulario";

/** Raízes que identificam cada modalidade no nome do tipo, já sem acento e em minúsculas. */
const RAIZES: ReadonlyArray<readonly [Modalidade, readonly string[]]> = [
  ["pilates", ["pilates"]],
  ["fisioterapia", ["fisio", "rpg", "reabilit"]],
  ["enfermagem", ["enferm", "curativo"]],
  ["medicina", ["medic"]],
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * A modalidade de um compromisso pelo nome do tipo de atendimento (ou, sem
 * tipo, pelo título). `null` quando nada casa — "Reunião", "Reavaliação" sem
 * modalidade no nome, bloqueio do Google.
 */
export function modalidadeDoTipo(nome: string | null | undefined): Modalidade | null {
  if (!nome) return null;
  const n = normalizar(nome);
  for (const [modalidade, raizes] of RAIZES) {
    if (raizes.some((r) => n.includes(normalizar(r)))) return modalidade;
  }
  return null;
}

/** A variável CSS da modalidade — `null` vira a cor neutra "outra". */
export function corDaModalidade(modalidade: Modalidade | null): string {
  return `var(--agenda-modalidade-${modalidade ?? "outra"})`;
}

/** Ordem da legenda: a mesma do vocabulário do módulo. */
export const MODALIDADES_DA_LEGENDA: readonly Modalidade[] = MODALIDADES;
