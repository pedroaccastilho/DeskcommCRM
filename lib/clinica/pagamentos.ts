/**
 * O PAGAMENTO REGISTRADO (módulo clínica, migration 9011). Pedido do Pedro (2026-10-15): "ter
 * algum lugar pra dizer se o aluno já pagou ou não, e qual foi a forma de pagamento", do pacote,
 * da consulta avulsa e da multa.
 *
 * É registro à mão, sem maquininha nem banco (integração de Pix e cartão é roadmap). Um pagamento
 * paga UMA coisa: um pacote, uma sessão avulsa ou uma multa. Registrar e desfazer é de
 * Administrador, Gerente, Recepção e Financeiro; os perfis de saúde e o Jurídico só leem. Os perfis
 * SOMAM, como na multa (`lib/clinica/multas.ts`).
 *
 * Esta é a régua única: as rotas recusam com ela (`lib/clinica/gestao-servidor.ts`) e a interface
 * nova esconde os botões com ela.
 */
import { z } from "zod";

import type { Role } from "@/lib/auth/types";

export const FORMAS_DE_PAGAMENTO = ["pix", "cartao_credito", "cartao_debito", "dinheiro"] as const;
export type FormaDePagamento = (typeof FORMAS_DE_PAGAMENTO)[number];

export const ROTULO_DA_FORMA: Record<FormaDePagamento, string> = {
  pix: "Pix",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  dinheiro: "Dinheiro",
};

/** Perfis que registram e desfazem pagamento. */
export const CARGOS_QUE_REGISTRAM_PAGAMENTO = [
  "administrador",
  "gerente",
  "recepcao",
  "financeiro",
] as const;

export const RECUSA_DO_PAGAMENTO =
  "Registrar pagamento é da recepção, do financeiro, da gerência e do administrador.";

export function registraPagamento(role: Role, cargos: readonly string[]): boolean {
  if (role === "viewer") return false;
  if (role === "admin") return true;
  return cargos.some((c) => (CARGOS_QUE_REGISTRAM_PAGAMENTO as readonly string[]).includes(c));
}

const uuid = z.string().uuid();

/** POST /api/v1/clinica/pagamentos: o que foi pago (exatamente um), a forma e o valor opcional. */
export const registrarPagamentoSchema = z
  .object({
    pacote_id: uuid.optional(),
    appointment_id: uuid.optional(),
    multa_id: uuid.optional(),
    forma: z.enum(FORMAS_DE_PAGAMENTO, { message: "Escolha a forma de pagamento." }),
    /** Ausente = o valor da coisa paga (pacote, preço do tipo ou multa). */
    valor_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  })
  .strict()
  .refine(
    (b) => [b.pacote_id, b.appointment_id, b.multa_id].filter(Boolean).length === 1,
    "Diga o que foi pago: um pacote, uma sessão ou uma multa.",
  );
export type RegistrarPagamento = z.infer<typeof registrarPagamentoSchema>;

export const pagamentosQuerySchema = z.object({ contact_id: uuid });

/** O pagamento como a tela lê. */
export interface PagamentoDaClinica {
  id: string;
  contact_id: string;
  pacote_id: string | null;
  appointment_id: string | null;
  multa_id: string | null;
  forma: FormaDePagamento;
  valor_cents: number | null;
  currency: string;
  pago_em: string;
}

/** O que a ficha precisa para dizer "pago" ou "a pagar" em cada coisa do paciente. */
export interface PagamentosDoPaciente {
  pagamentos: PagamentoDaClinica[];
  /** Sessões que gastaram um pacote: não são avulsas, quem paga é o pacote. */
  sessoes_em_pacote: string[];
}

/** O pagamento de uma coisa, se houver. */
export function pagamentoDe(
  dados: PagamentosDoPaciente | undefined,
  alvo: { pacote_id?: string; appointment_id?: string; multa_id?: string },
): PagamentoDaClinica | null {
  if (!dados) return null;
  return (
    dados.pagamentos.find(
      (p) =>
        (alvo.pacote_id !== undefined && p.pacote_id === alvo.pacote_id) ||
        (alvo.appointment_id !== undefined && p.appointment_id === alvo.appointment_id) ||
        (alvo.multa_id !== undefined && p.multa_id === alvo.multa_id),
    ) ?? null
  );
}

/**
 * A sessão é cobrada à parte (avulsa)? Não quando gastou um pacote, nem quando ainda vai gastar um
 * que está valendo; e não quando foi cancelada ou o paciente faltou (o que se cobra aí é a multa).
 */
export function sessaoAvulsa(args: {
  appointmentId: string;
  status: string;
  temPacoteValendo: boolean;
  dados: PagamentosDoPaciente | undefined;
}): boolean {
  // Já paga como avulsa: segue avulsa, mesmo que um pacote tenha sido vendido depois.
  if (pagamentoDe(args.dados, { appointment_id: args.appointmentId })) return true;
  if (["cancelled", "rescheduled", "no_show"].includes(args.status)) return false;
  if (args.dados?.sessoes_em_pacote.includes(args.appointmentId)) return false;
  return !args.temPacoteValendo;
}
