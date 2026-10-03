/**
 * MEU DIA, a tela do profissional de saúde (fork TOQ, módulo clínica). Regra pura.
 *
 * O profissional abre o sistema e vê só os próprios horários do dia, já com o paciente da vez
 * aberto em modo atendimento: o que foi feito na última sessão à esquerda e a evolução à direita.
 * A situação de cada horário é a mesma do Balcão (`situacaoNoBalcao`), para recepção e
 * profissional falarem a mesma língua.
 */
import type { SessaoDaGrade } from "./agenda";
import { situacaoNoBalcao, type SituacaoNoBalcao } from "./balcao";
import type { Modalidade, TipoDeRegistro } from "./vocabulario";

export interface SessaoDoMeuDia extends SessaoDaGrade {
  situacao: SituacaoNoBalcao;
}

/** Os horários do dia que são de quem está logado, em ordem, sem os cancelados. */
export function minhasSessoes(
  sessoes: readonly SessaoDaGrade[],
  meuId: string,
  agora: Date,
): SessaoDoMeuDia[] {
  return sessoes
    .filter((s) => s.profissional_user_id === meuId && s.status !== "cancelled")
    .map((s) => ({ ...s, situacao: situacaoNoBalcao(s, agora) }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/**
 * O paciente da vez: o primeiro horário ainda aberto cujo fim não passou (quem está na sala ou é
 * o próximo). Sem nenhum, o último do dia, para o profissional terminar de registrar.
 */
export function pacienteDaVez(
  sessoes: readonly SessaoDoMeuDia[],
  agora: Date,
): SessaoDoMeuDia | null {
  const abertas = sessoes.filter(
    (s) => s.situacao !== "realizado" && s.situacao !== "faltou" && s.situacao !== "cancelado",
  );
  return (
    abertas.find((s) => new Date(s.fim).getTime() > agora.getTime()) ??
    abertas[0] ??
    sessoes[sessoes.length - 1] ??
    null
  );
}

/** O mínimo que a tela precisa de um registro do prontuário. */
export interface RegistroAnterior {
  modalidade: Modalidade;
  tipo: TipoDeRegistro;
  conteudo: Record<string, string | number>;
  assinado_em: string;
}

/** O último registro assinado da modalidade (avaliação, evolução ou anamnese; nunca adendo). */
export function ultimoRegistro(
  registros: readonly RegistroAnterior[],
  modalidade: Modalidade,
): RegistroAnterior | null {
  return (
    registros
      .filter((r) => r.modalidade === modalidade && r.tipo !== "adendo" && r.tipo !== "alta")
      .sort((a, b) => b.assinado_em.localeCompare(a.assinado_em))[0] ?? null
  );
}

/**
 * O que "Repetir a conduta" copia da última sessão para a evolução de hoje. É só o que se repete
 * de uma sessão para outra (o tratamento), nunca o que se mede de novo (dor, sinais vitais).
 */
export const CAMPOS_QUE_SE_REPETEM: Record<Modalidade, readonly string[]> = {
  fisioterapia: ["conduta", "plano"],
  pilates: ["objetivo", "restricoes", "aparelhos", "exercicios"],
  medicina: ["conduta", "prescricao"],
  enfermagem: ["procedimento"],
};

/**
 * Os valores a copiar. A avaliação de fisioterapia guarda o tratamento em `condutas_previstas`;
 * na evolução ele vira a `conduta` do dia.
 */
export function valoresParaRepetir(registro: RegistroAnterior | null): Record<string, string> {
  if (!registro) return {};
  const conteudo = registro.conteudo;
  const fora: Record<string, string> = {};
  for (const chave of CAMPOS_QUE_SE_REPETEM[registro.modalidade]) {
    const valor = conteudo[chave];
    if (valor !== undefined && String(valor).trim() !== "") fora[chave] = String(valor);
  }
  if (!fora.conduta && conteudo.condutas_previstas && registro.modalidade === "fisioterapia") {
    fora.conduta = String(conteudo.condutas_previstas);
  }
  return fora;
}

// ─── Próximo passo, depois de assinar ────────────────────────────────────────

/** O mínimo de um compromisso da agenda (`GET /api/v1/agenda/agendamentos`) para esta conta. */
export interface CompromissoFuturo {
  id: string;
  iniciaEm: string;
  situacao: string;
}

/**
 * A próxima sessão do paciente que já está marcada: a primeira depois de agora que não foi
 * cancelada, fora a de hoje que acabou de ser atendida. `null` quando ainda não há nenhuma, que é
 * exatamente quando o profissional precisa marcar.
 */
export function proximaJaMarcada(
  compromissos: readonly CompromissoFuturo[],
  sessaoAtualId: string,
  agora: Date,
): CompromissoFuturo | null {
  return (
    compromissos
      .filter(
        (c) =>
          c.id !== sessaoAtualId &&
          c.situacao !== "cancelled" &&
          new Date(c.iniciaEm).getTime() > agora.getTime(),
      )
      .sort((a, b) => a.iniciaEm.localeCompare(b.iniciaEm))[0] ?? null
  );
}

/** O próximo horário ainda aberto do dia, depois do que está na tela. */
export function proximoDoDia(
  sessoes: readonly SessaoDoMeuDia[],
  atualId: string,
): SessaoDoMeuDia | null {
  const i = sessoes.findIndex((s) => s.id === atualId);
  if (i < 0) return null;
  return (
    sessoes
      .slice(i + 1)
      .find(
        (s) => s.situacao !== "realizado" && s.situacao !== "faltou" && s.situacao !== "cancelado",
      ) ?? null
  );
}

/**
 * Quantos dias depois de hoje a janela de marcar abre por padrão: uma semana, o mesmo dia da
 * semana de hoje, que é como a clínica costuma manter o tratamento.
 */
export const DIAS_ATE_A_PROXIMA_SUGERIDA = 7;
