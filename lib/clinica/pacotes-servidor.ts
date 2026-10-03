/**
 * PACOTES DE SESSÕES — leitura e escrita no banco (módulo clínica, migration 9004).
 *
 * As contas puras estão em `./pacotes.ts`. Aqui ficam as consultas que as rotas e a agenda
 * compartilham: a lista com saldo, o valor da sessão para a multa, o preço avulso para o
 * reembolso e o lançamento da sessão no pacote.
 *
 * ⚠️ ORGANIZAÇÃO SEMPRE DO CONTEXTO. Toda função recebe a organização de quem chamou (cookie
 * validado ou contexto do handler) e a põe em todo filtro, porque o client de serviço ignora a RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { COLUNAS_DAS_REGRAS, regrasDaLinha, type RegrasDaClinica } from "./agenda";
import { moduloClinicaNaoInstalado } from "./api";
import {
  precisaRenovar,
  saldoDoPacote,
  situacaoDoPacote,
  valorDaSessaoNoPacote,
  type MotivoDoConsumo,
  type SituacaoDoPacote,
} from "./pacotes";
import type { Modalidade } from "./vocabulario";

type SB = SupabaseClient;

export const COLUNAS_DO_PRODUTO =
  "id, nome, modalidade, sessoes, validade_dias, valor_cents, currency, ativo, created_at, updated_at";

export const COLUNAS_DO_PACOTE =
  "id, contact_id, produto_id, nome, modalidade, sessoes_total, valor_cents, currency, comprado_em, valido_ate, status, congelado_em, congelado_dias, cancelado_em, cancelamento_motivo, aceite_politica_em, aceite_multa_pct, aceite_antecedencia_horas, vendido_por_user_id, created_at, clinica_pacote_consumos(count)";

export interface LinhaDoPacote {
  id: string;
  contact_id: string;
  produto_id: string | null;
  nome: string;
  modalidade: Modalidade;
  sessoes_total: number;
  valor_cents: number | string | null;
  currency: string;
  comprado_em: string;
  valido_ate: string;
  status: "ativo" | "cancelado";
  congelado_em: string | null;
  congelado_dias: number | null;
  cancelado_em: string | null;
  cancelamento_motivo: string | null;
  aceite_politica_em: string;
  aceite_multa_pct: number;
  aceite_antecedencia_horas: number;
  vendido_por_user_id: string | null;
  created_at: string;
  clinica_pacote_consumos?: Array<{ count: number }> | null;
}

/** O pacote como as rotas o devolvem (contrato em `/mnt/project-files/backend/contrato-agenda-clinica.md`). */
export interface PacoteComSaldo extends Omit<
  LinhaDoPacote,
  "clinica_pacote_consumos" | "valor_cents"
> {
  valor_cents: number | null;
  sessoes_usadas: number;
  saldo: number;
  situacao: SituacaoDoPacote;
  precisa_renovar: boolean;
}

export function pacoteComSaldo(
  linha: LinhaDoPacote,
  limiteDeRenovacao: number,
  agora: Date = new Date(),
): PacoteComSaldo {
  const { clinica_pacote_consumos: consumos, valor_cents, ...resto } = linha;
  const usadas = Number(consumos?.[0]?.count ?? 0);
  const base = {
    status: linha.status,
    sessoes_total: linha.sessoes_total,
    sessoes_usadas: usadas,
    valido_ate: linha.valido_ate,
  };
  return {
    ...resto,
    valor_cents: valor_cents === null ? null : Number(valor_cents),
    sessoes_usadas: usadas,
    saldo: saldoDoPacote(base),
    situacao: situacaoDoPacote(base, agora),
    precisa_renovar: precisaRenovar(base, limiteDeRenovacao, agora),
  };
}

/** As Regras da clínica gravadas, ou as padrão (pacote de 10 sessões, 60 dias, aviso com 2). */
export async function regrasDaOrganizacao(
  db: SB,
  organizationId: string,
): Promise<RegrasDaClinica> {
  const { data, error } = await db
    .from("clinica_politicas")
    .select(COLUNAS_DAS_REGRAS.join(", "))
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error && !moduloClinicaNaoInstalado(error)) throw error;
  return regrasDaLinha(data as Partial<RegrasDaClinica> | null);
}

/** Os pacotes ativos do paciente naquela modalidade, do que vence primeiro ao último. */
async function pacotesAtivosDoPaciente(
  db: SB,
  organizationId: string,
  contactId: string,
  modalidade: Modalidade,
  em: Date,
): Promise<PacoteComSaldo[]> {
  const { data, error } = await db
    .from("clinica_pacotes")
    .select(COLUNAS_DO_PACOTE)
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .eq("modalidade", modalidade)
    .eq("status", "ativo")
    .gte("valido_ate", em.toISOString())
    .order("valido_ate", { ascending: true });
  if (error) {
    if (moduloClinicaNaoInstalado(error)) return [];
    throw error;
  }
  return ((data ?? []) as unknown as LinhaDoPacote[])
    .map((l) => pacoteComSaldo(l, 0, em))
    .filter((p) => p.saldo > 0);
}

/**
 * O valor da sessão para a multa, quando o paciente tem pacote daquela modalidade com valor:
 * total do pacote dividido pelas sessões (regra da TOQ). `null` = vale o preço avulso do tipo.
 */
export async function valorDaSessaoPeloPacote(
  db: SB,
  organizationId: string,
  contactId: string,
  modalidade: Modalidade,
  em: Date,
): Promise<{ valor_cents: number; currency: string } | null> {
  const ativos = await pacotesAtivosDoPaciente(db, organizationId, contactId, modalidade, em);
  for (const p of ativos) {
    const valor = valorDaSessaoNoPacote(p.valor_cents, p.sessoes_total);
    if (valor !== null) return { valor_cents: valor, currency: p.currency };
  }
  return null;
}

/**
 * O preço AVULSO da sessão daquela modalidade, base do reembolso: o "Preço padrão" dos tipos de
 * agendamento etiquetados com ela. Só responde quando todos os tipos com preço concordam; com
 * dois preços diferentes (avaliação e sessão, por exemplo) não há como escolher, e a gerência
 * informa o valor.
 */
export async function precoAvulsoDaModalidade(
  db: SB,
  organizationId: string,
  modalidade: Modalidade,
): Promise<number | null> {
  const { data, error } = await db
    .from("clinica_tipos_atendimento")
    .select("event_type_id, calendar_event_types(default_price_cents)")
    .eq("organization_id", organizationId)
    .eq("modalidade", modalidade);
  if (error) {
    if (moduloClinicaNaoInstalado(error)) return null;
    throw error;
  }
  const precos = new Set<number>();
  for (const linha of (data ?? []) as unknown as Array<{
    calendar_event_types: { default_price_cents: number | string | null } | null;
  }>) {
    const bruto = linha.calendar_event_types?.default_price_cents;
    if (bruto !== null && bruto !== undefined) precos.add(Number(bruto));
  }
  return precos.size === 1 ? [...precos][0]! : null;
}

export interface LancamentoNoPacote {
  pacote_id: string;
  saldo: number | null;
  acao: "lancada" | "ja_lancada" | "estornada";
}

/**
 * Lança a sessão no pacote (`realizada`/`falta`) ou a tira dele (`null`). Devolve `null` quando
 * a sessão é avulsa ou não havia o que tirar. Pede o client de SERVIÇO: a função só
 * `service_role` executa.
 */
export async function lancarSessaoNoPacote(
  admin: SB,
  organizationId: string,
  appointmentId: string,
  modalidade: Modalidade,
  motivo: MotivoDoConsumo | null,
): Promise<LancamentoNoPacote | null> {
  const { data, error } = await admin.rpc("fn_clinica_consumir_sessao", {
    p_org: organizationId,
    p_appointment: appointmentId,
    p_modalidade: modalidade,
    p_motivo: motivo,
  });
  if (error) {
    // Módulo instalado antes da 9004 e ainda não reaplicado: a função existe, as tabelas não.
    if (moduloClinicaNaoInstalado(error) || error.code === "42883") return null;
    throw error;
  }
  const linha = ((data ?? []) as LancamentoNoPacote[])[0];
  return linha ?? null;
}

/** Recusas de `fn_clinica_ajustar_pacote`, com a mensagem para a recepção. */
export const RECUSAS_DO_AJUSTE: Record<string, { status: number; code: string; mensagem: string }> =
  {
    clinica_pacote_nao_encontrado: {
      status: 404,
      code: "not_found",
      mensagem: "Pacote não encontrado nesta clínica.",
    },
    clinica_pacote_cancelado: {
      status: 409,
      code: "clinica_pacote_cancelado",
      mensagem: "Este pacote já foi cancelado.",
    },
    clinica_pacote_ja_congelado: {
      status: 409,
      code: "clinica_pacote_ja_congelado",
      mensagem: "Este pacote já foi congelado uma vez. O congelamento vale uma vez por pacote.",
    },
    clinica_pacote_vencido: {
      status: 409,
      code: "clinica_pacote_vencido",
      mensagem: "Este pacote já venceu. Para voltar a usá-lo, peça à gerência para prorrogar.",
    },
    clinica_congelamento_acima_do_maximo: {
      status: 422,
      code: "clinica_congelamento_acima_do_maximo",
      mensagem: "O congelamento passa do máximo permitido nas Regras da clínica.",
    },
    clinica_prorrogacao_invalida: {
      status: 422,
      code: "validation_failed",
      mensagem: "Informe de 1 a 730 dias de prorrogação.",
    },
  };

/** A recusa conhecida que o banco levantou, ou `null` (erro de verdade). */
export function recusaDoAjuste(
  error: { message?: string } | null,
): (typeof RECUSAS_DO_AJUSTE)[string] | null {
  const msg = error?.message ?? "";
  for (const [chave, recusa] of Object.entries(RECUSAS_DO_AJUSTE)) {
    if (msg.includes(chave)) return recusa;
  }
  return null;
}
