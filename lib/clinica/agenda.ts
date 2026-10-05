/**
 * AS REGRAS DA AGENDA DA CLÍNICA QUE SE DECIDEM SEM BANCO (módulo clínica, migration 9002).
 *
 * Multa de cancelamento em cima da hora e tolerância de atraso antes de registrar falta. As regras
 * vêm de /mnt/project-files/produto/regras-de-negocio.md (PO da TOQ): cancelar com menos de 24h
 * gera multa de 30% do valor da sessão, configurável; quem falta sem avisar perde a sessão; a
 * tolerância de atraso é de 15 minutos.
 *
 * Funções puras, de propósito: quem chama (`regras-da-agenda.ts`) lê o banco e grava; a decisão
 * mora aqui, onde se testa sem banco.
 */
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

import type { Modalidade } from "./vocabulario";

export { MODALIDADES, type Modalidade } from "./vocabulario";

export interface PoliticaDaAgenda {
  antecedencia_cancelamento_horas: number;
  multa_cancelamento_pct: number;
  tolerancia_atraso_minutos: number;
}

/**
 * O que vale quando a clínica não gravou política. É a ÚNICA cópia destes números fora do
 * DEFAULT das colunas de `clinica_politicas` (migration 9002); os dois têm de bater.
 */
export const POLITICA_PADRAO: Readonly<PoliticaDaAgenda> = Object.freeze({
  antecedencia_cancelamento_horas: 24,
  multa_cancelamento_pct: 30,
  tolerancia_atraso_minutos: 15,
});

/**
 * As REGRAS DA CLÍNICA inteiras (migration 9003): a política da agenda e os parâmetros de pacote
 * e de acompanhamento. Os de pacote valem desde a 9004 (venda, congelamento e renovação, em
 * `lib/clinica/pacotes-servidor.ts`), menos as reposições; os de acompanhamento ficam guardados
 * para quando os alertas existirem.
 */
export interface RegrasDaClinica extends PoliticaDaAgenda {
  pacote_sessoes_padrao: number;
  pacote_validade_dias: number;
  reposicoes_por_mes: number;
  congelamento_max_dias: number;
  sessoes_restantes_aviso_renovacao: number;
  faltas_seguidas_alerta: number;
  faltas_no_mes_abandono: number;
  dias_sem_sessao_inativo: number;
  horas_evolucao_atrasada: number;
}

/** Os padrões das regras, iguais aos DEFAULT das colunas de `clinica_politicas` (9002 e 9003). */
export const REGRAS_PADRAO: Readonly<RegrasDaClinica> = Object.freeze({
  ...POLITICA_PADRAO,
  pacote_sessoes_padrao: 10,
  pacote_validade_dias: 60,
  reposicoes_por_mes: 2,
  congelamento_max_dias: 30,
  sessoes_restantes_aviso_renovacao: 2,
  faltas_seguidas_alerta: 2,
  faltas_no_mes_abandono: 3,
  dias_sem_sessao_inativo: 30,
  horas_evolucao_atrasada: 24,
});

/** As colunas de `clinica_politicas` que formam as regras, na ordem de `REGRAS_PADRAO`. */
export const COLUNAS_DAS_REGRAS = Object.keys(REGRAS_PADRAO) as ReadonlyArray<keyof RegrasDaClinica>;

/** Lê uma linha de `clinica_politicas` (ou nada) como regras completas. */
export function regrasDaLinha(linha: Partial<RegrasDaClinica> | null | undefined): RegrasDaClinica {
  const regras = { ...REGRAS_PADRAO };
  for (const coluna of COLUNAS_DAS_REGRAS) {
    const valor = linha?.[coluna];
    if (typeof valor === "number") regras[coluna] = valor;
  }
  return regras;
}

export type QuemCancelou = "paciente" | "clinica";

export interface MultaCalculada {
  percentual: number;
  /** Horas entre o cancelamento e o início da sessão (negativo se cancelou depois do início). */
  antecedencia_horas: number;
  /** `null` quando o tipo ainda não tem valor de sessão. */
  valor_cents: number | null;
}

const HORA_MS = 60 * 60 * 1000;

/**
 * Decide se o cancelamento gera multa, e de quanto.
 *
 * Sem multa quando: a clínica cancelou; a política está com 0%; ou o aviso veio com pelo menos a
 * antecedência da política. Cancelar DEPOIS do início também é em cima da hora (gera multa).
 */
export function multaDoCancelamento(args: {
  inicio: Date;
  canceladoEm: Date;
  politica: PoliticaDaAgenda;
  valorDaSessaoCents: number | null;
  quemCancelou: QuemCancelou;
}): MultaCalculada | null {
  if (args.quemCancelou === "clinica") return null;
  const pct = args.politica.multa_cancelamento_pct;
  if (pct <= 0) return null;
  const antecedenciaMs = args.inicio.getTime() - args.canceladoEm.getTime();
  if (antecedenciaMs >= args.politica.antecedencia_cancelamento_horas * HORA_MS) return null;
  return {
    percentual: pct,
    antecedencia_horas: Math.round((antecedenciaMs / HORA_MS) * 100) / 100,
    valor_cents:
      args.valorDaSessaoCents === null ? null : Math.round((args.valorDaSessaoCents * pct) / 100),
  };
}

/** A partir de quando a recepção pode registrar "não compareceu". */
export function faltaLiberadaEm(inicio: Date, politica: PoliticaDaAgenda): Date {
  return new Date(inicio.getTime() + politica.tolerancia_atraso_minutos * 60_000);
}

/** Até quando o paciente cancela sem multa. */
export function cancelamentoSemMultaAte(inicio: Date, politica: PoliticaDaAgenda): Date {
  return new Date(inicio.getTime() - politica.antecedencia_cancelamento_horas * HORA_MS);
}

/** Lê uma linha de `clinica_politicas` (ou nada) como política completa. */
export function politicaDaLinha(linha: Partial<PoliticaDaAgenda> | null | undefined): PoliticaDaAgenda {
  return {
    antecedencia_cancelamento_horas:
      linha?.antecedencia_cancelamento_horas ?? POLITICA_PADRAO.antecedencia_cancelamento_horas,
    multa_cancelamento_pct: linha?.multa_cancelamento_pct ?? POLITICA_PADRAO.multa_cancelamento_pct,
    tolerancia_atraso_minutos:
      linha?.tolerancia_atraso_minutos ?? POLITICA_PADRAO.tolerancia_atraso_minutos,
  };
}

/** A ação do histórico para cada transição da agenda do núcleo; `null` = não entra no histórico. */
export function acaoDoHistorico(
  transicao: string,
): "remarcado" | "cancelado" | "falta" | "realizado" | "confirmado" | null {
  switch (transicao) {
    case "rescheduled":
      return "remarcado";
    case "cancelled":
      return "cancelado";
    case "no_show":
      return "falta";
    case "completed":
      return "realizado";
    case "confirmed":
      return "confirmado";
    default:
      return null;
  }
}

/** Uma sessão como a grade da agenda da clínica a devolve (contrato de `GET /api/v1/clinica/agenda`). */
export interface SessaoDaGrade {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  status: string;
  profissional_user_id: string | null;
  modalidade: Modalidade | null;
  tipo: { id: string; nome: string } | null;
  paciente: { id: string; nome: string; telefone: string | null } | null;
  /** A partir de quando a recepção pode marcar "não compareceu" (só sessão da clínica). */
  falta_liberada_em: string | null;
  /** Até quando o paciente cancela sem multa (só sessão da clínica). */
  cancelamento_sem_multa_ate: string | null;
  /** Quando a recepção marcou que o paciente chegou (migration 9007); `null` = não chegou. */
  chegou_em: string | null;
  /** Quando o atendimento começou (migration 9007); `null` = ainda não começou. */
  atendimento_iniciado_em: string | null;
}

/** A etapa do dia de uma sessão, como `clinica_sessao_etapas` a guarda (migration 9007). */
export interface EtapaDaSessao {
  chegou_em: string | null;
  atendimento_iniciado_em: string | null;
}

/** A linha inteira da etapa, com quem marcou cada passo. */
export interface EtapaComAutoria extends EtapaDaSessao {
  chegou_por_user_id: string | null;
  atendimento_iniciado_por_user_id: string | null;
}

/** Os status do núcleo em que a sessão ainda está em aberto e aceita etapa do dia. */
export const STATUS_QUE_ACEITAM_ETAPA = ["pending", "confirmed"] as const;

/**
 * A etapa depois do pedido. Pura. Marcar de novo o que já está marcado não muda nada (nem a hora,
 * nem quem marcou): é o que torna o botão idempotente. "em_atendimento" sem chegada marca as duas,
 * porque não existe atendimento sem chegada (CHECK da 9007).
 */
export function proximaEtapa(
  atual: EtapaComAutoria | null,
  pedida: "chegou" | "em_atendimento" | "desfazer",
  agora: string,
  userId: string,
): EtapaComAutoria {
  if (pedida === "desfazer") {
    return {
      chegou_em: null,
      chegou_por_user_id: null,
      atendimento_iniciado_em: null,
      atendimento_iniciado_por_user_id: null,
    };
  }
  const chegada = atual?.chegou_em
    ? { chegou_em: atual.chegou_em, chegou_por_user_id: atual.chegou_por_user_id }
    : { chegou_em: agora, chegou_por_user_id: userId };
  if (pedida === "chegou") {
    return {
      ...chegada,
      atendimento_iniciado_em: atual?.atendimento_iniciado_em ?? null,
      atendimento_iniciado_por_user_id: atual?.atendimento_iniciado_por_user_id ?? null,
    };
  }
  return {
    ...chegada,
    ...(atual?.atendimento_iniciado_em
      ? {
          atendimento_iniciado_em: atual.atendimento_iniciado_em,
          atendimento_iniciado_por_user_id: atual.atendimento_iniciado_por_user_id,
        }
      : { atendimento_iniciado_em: agora, atendimento_iniciado_por_user_id: userId }),
  };
}

export interface LinhaDoCompromisso {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  owner_user_id: string | null;
  event_type_id: string | null;
  contact_id: string | null;
  contacts: { name: string | null; display_name: string | null; phone_number: string | null } | null;
}

/** Linha do banco → sessão da grade. Pura, para a rota e o teste falarem a mesma língua. */
export function sessaoDaGrade(
  linha: LinhaDoCompromisso,
  tipos: ReadonlyMap<string, { nome: string; modalidade: Modalidade | null }>,
  politica: PoliticaDaAgenda,
  etapa: EtapaDaSessao | null = null,
): SessaoDaGrade {
  const tipo = linha.event_type_id ? tipos.get(linha.event_type_id) : undefined;
  const modalidade = tipo?.modalidade ?? null;
  const inicio = new Date(linha.starts_at);
  const contato = linha.contacts;
  return {
    id: linha.id,
    titulo: linha.title,
    inicio: linha.starts_at,
    fim: linha.ends_at,
    status: linha.status,
    profissional_user_id: linha.owner_user_id,
    modalidade,
    tipo:
      linha.event_type_id && tipo
        ? { id: linha.event_type_id, nome: tipo.nome }
        : null,
    paciente: linha.contact_id
      ? {
          id: linha.contact_id,
          nome: rotuloDoContato(contato),
          telefone: contato?.phone_number ?? null,
        }
      : null,
    falta_liberada_em: modalidade ? faltaLiberadaEm(inicio, politica).toISOString() : null,
    cancelamento_sem_multa_ate: modalidade
      ? cancelamentoSemMultaAte(inicio, politica).toISOString()
      : null,
    chegou_em: etapa?.chegou_em ?? null,
    atendimento_iniciado_em: etapa?.atendimento_iniciado_em ?? null,
  };
}
