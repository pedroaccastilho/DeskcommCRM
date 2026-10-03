/**
 * O PLANO DE TRATAMENTO — as regras puras (módulo clínica, migration 9006).
 *
 * O plano nasce no banco, do gatilho da avaliação assinada. Daqui saem as três perguntas que a
 * tela e o servidor fazem sobre ele, sem banco nenhum:
 *
 * 1. Em que etapa o paciente está (avaliado, em tratamento, alta)?
 * 2. Que tipo de agendamento serve para o retorno de reavaliação?
 * 3. Qual horário livre reservar: o primeiro do dia pedido ou, sem vaga, o mais próximo depois?
 */
import type { Modalidade } from "./vocabulario";

export const SITUACOES_DO_PLANO = ["ativo", "substituido", "alta"] as const;
export type SituacaoDoPlano = (typeof SITUACOES_DO_PLANO)[number];

export const SITUACOES_DO_RETORNO = [
  "nao_pedido",
  "a_marcar",
  "marcado",
  "marcado_outro_dia",
  "sem_horario",
  "sem_tipo",
] as const;
export type SituacaoDoRetorno = (typeof SITUACOES_DO_RETORNO)[number];

export const AVISOS_DO_RETORNO = ["nao_enviado", "enviado", "nao_deu"] as const;
export type AvisoDoRetorno = (typeof AVISOS_DO_RETORNO)[number];

/** A linha de `clinica_planos_tratamento` como as rotas a leem. */
export type LinhaDoPlano = {
  id: string;
  contact_id: string;
  modalidade: Modalidade;
  avaliacao_appointment_id: string | null;
  avaliador_user_id: string | null;
  avaliador_nome: string;
  sessoes_previstas: number | null;
  frequencia_semanal: number | null;
  /** `AAAA-MM-DD`. */
  reavaliacao_em: string | null;
  situacao: SituacaoDoPlano;
  alta_motivo: string | null;
  encerrado_em: string | null;
  retorno_situacao: SituacaoDoRetorno;
  retorno_appointment_id: string | null;
  retorno_aviso: AvisoDoRetorno;
  created_at: string;
};

export const COLUNAS_DO_PLANO =
  "id, contact_id, modalidade, avaliacao_appointment_id, avaliador_user_id, avaliador_nome, " +
  "sessoes_previstas, frequencia_semanal, reavaliacao_em, situacao, alta_motivo, encerrado_em, " +
  "retorno_situacao, retorno_appointment_id, retorno_aviso, created_at";

/** A etapa da jornada que o plano diz. `substituido` não é etapa: a tela mostra o plano novo. */
export type EtapaDoPaciente = "avaliado" | "em_tratamento" | "alta";

export function etapaDoPlano(
  plano: Pick<LinhaDoPlano, "situacao">,
  sessoesFeitas: number,
): EtapaDoPaciente | null {
  if (plano.situacao === "alta") return "alta";
  if (plano.situacao === "substituido") return null;
  return sessoesFeitas > 0 ? "em_tratamento" : "avaliado";
}

/**
 * "Sessão 6 de 10": a próxima sessão a acontecer, contada a partir das feitas. Depois da última
 * prevista, a conta segue ("sessão 11 de 10") de propósito: passar do previsto é sinal para o
 * profissional reavaliar, e esconder isso enganaria.
 */
export function sessaoAtual(sessoesFeitas: number): number {
  return sessoesFeitas + 1;
}

/** Um tipo de agendamento da modalidade, como o servidor o lê para escolher o do retorno. */
export type TipoCandidato = { id: string; nome: string; ativo: boolean };

/**
 * O tipo do retorno: o que tem "reavaliação" no nome; senão, "avaliação"; senão, o primeiro tipo
 * ativo da modalidade. `null` quando a modalidade não tem tipo nenhum (a recepção é avisada).
 * O tipo de agendamento ainda não tem um campo que diga "isto é reavaliação" (mesma régua de
 * `resumo-do-paciente.ts`).
 */
function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function tipoDoRetorno(tipos: readonly TipoCandidato[]): TipoCandidato | null {
  const ativos = tipos.filter((t) => t.ativo);
  const com = (pedaco: string) => ativos.find((t) => semAcento(t.nome).includes(pedaco));
  return com("reavalia") ?? com("avalia") ?? ativos[0] ?? null;
}

export type EscolhaDoHorario = { inicio: Date; noDiaPedido: boolean } | null;

/**
 * O horário do retorno entre os livres (já em ordem ou não): o primeiro do dia pedido; sem vaga
 * nele, o primeiro depois dele. `diaDe` traduz um instante para o dia civil `AAAA-MM-DD` no fuso
 * da agenda — o dia pedido é do calendário da clínica, não de UTC.
 */
export function horarioDoRetorno(
  livres: readonly { inicio: Date }[],
  diaPedido: string,
  diaDe: (instante: Date) => string,
): EscolhaDoHorario {
  const ordenados = [...livres].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const noDia = ordenados.find((s) => diaDe(s.inicio) === diaPedido);
  if (noDia) return { inicio: noDia.inicio, noDiaPedido: true };
  const depois = ordenados.find((s) => diaDe(s.inicio) > diaPedido);
  return depois ? { inicio: depois.inicio, noDiaPedido: false } : null;
}

/** Quantos dias depois do pedido o servidor procura vaga antes de desistir e avisar a recepção. */
export const DIAS_DE_PROCURA_DO_RETORNO = 14;
