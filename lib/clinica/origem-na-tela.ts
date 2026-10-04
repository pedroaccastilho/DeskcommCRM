/**
 * A origem do paciente na TELA: as contas do cadastro, da ficha e do relatório, sem React
 * (módulo clínica, migration 9005). O vocabulário e a validação moram em `./origens`.
 */
import { COMPLEMENTO_DO_TIPO, recusaDaOrigemDoPaciente, type TipoDeOrigem } from "./origens";

/** A origem como `GET/PUT /api/v1/clinica/pacientes/{id}/origem` devolve. */
export interface OrigemDoPaciente {
  contact_id: string;
  origem: { id: string; nome: string; tipo: TipoDeOrigem } | null;
  detalhe: string | null;
  indicado_por: { id: string; nome: string } | null;
  automatica: boolean;
  registrado_por_user_id: string | null;
  atualizado_em: string | null;
}

/** O que a recepção escolheu no formulário, antes de virar corpo do PUT. */
export interface OrigemEscolhida {
  origem_id: string;
  tipo: TipoDeOrigem;
  detalhe: string;
  indicado_por: { id: string; nome: string } | null;
}

/** O formulário aberto em cima do que já está gravado (ou vazio, sem origem). */
export function escolhaInicial(atual: OrigemDoPaciente | null | undefined): OrigemEscolhida | null {
  if (!atual?.origem) return null;
  return {
    origem_id: atual.origem.id,
    tipo: atual.origem.tipo,
    detalhe: atual.detalhe ?? "",
    indicado_por: atual.indicado_por,
  };
}

/**
 * O corpo do PUT só com o que o tipo pede: trocar de "Encaminhamento" para "WhatsApp" não pode
 * levar junto o nome do médico digitado antes.
 */
export function corpoDaOrigem(escolha: OrigemEscolhida): {
  origem_id: string;
  detalhe: string | null;
  indicado_por_contact_id: string | null;
} {
  const complemento = COMPLEMENTO_DO_TIPO[escolha.tipo];
  const detalhe = escolha.detalhe.trim();
  return {
    origem_id: escolha.origem_id,
    detalhe: complemento === "indicado_por" || detalhe === "" ? null : detalhe,
    indicado_por_contact_id: complemento === "indicado_por" ? (escolha.indicado_por?.id ?? null) : null,
  };
}

/** A mesma recusa do servidor, antes de gastar a ida: `null` quando pode gravar. */
export function recusaDaEscolha(escolha: OrigemEscolhida, contactId: string): string | null {
  return recusaDaOrigemDoPaciente(escolha.tipo, corpoDaOrigem(escolha), contactId);
}

/** Dia AAAA-MM-DD em horário de Brasília, como o relatório conta. */
function diaDeBrasilia(instante: Date): string {
  return new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export type AtalhoDePeriodo = "este_mes" | "mes_passado" | "ultimos_90";

/** Os períodos prontos do relatório, em dias de Brasília, `ate` inclusive. */
export function periodoDoAtalho(
  atalho: AtalhoDePeriodo,
  agora: Date = new Date(),
): { de: string; ate: string } {
  const hoje = diaDeBrasilia(agora);
  const [ano, mes] = hoje.split("-").map(Number) as [number, number];
  if (atalho === "este_mes") return { de: `${hoje.slice(0, 8)}01`, ate: hoje };
  if (atalho === "mes_passado") {
    const inicio = new Date(Date.UTC(ano, mes - 2, 1));
    const fim = new Date(Date.UTC(ano, mes - 1, 0));
    return { de: inicio.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
  }
  const de = new Date(Date.parse(`${hoje}T00:00:00Z`) - 89 * 86_400_000);
  return { de: de.toISOString().slice(0, 10), ate: hoje };
}
