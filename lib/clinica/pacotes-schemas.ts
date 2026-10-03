/** Validação (Zod) do que entra pelas rotas de pacotes da clínica (migration 9004). */
import { z } from "zod";

import { MODALIDADES } from "@/lib/clinica/vocabulario";

import { SITUACOES_DO_PACOTE } from "./pacotes";

/** Faixas iguais aos CHECK das tabelas de pacote. */
const nome = z.string().trim().min(2).max(120);
const sessoes = z.number().int().min(1).max(100);
const validadeDias = z.number().int().min(1).max(730);
/** `null` = ainda sem preço: a clínica não definiu os valores, e o pacote funciona sem eles. */
const valorCents = z.number().int().min(0).max(100_000_000).nullable();
const motivo = z.string().trim().min(3).max(1000);

export const produtoSchema = z
  .object({
    nome,
    modalidade: z.enum(MODALIDADES),
    sessoes,
    validade_dias: validadeDias,
    valor_cents: valorCents.default(null),
    ativo: z.boolean().default(true),
  })
  .strict();

export const produtoPatchSchema = z
  .object({
    nome,
    modalidade: z.enum(MODALIDADES),
    sessoes,
    validade_dias: validadeDias,
    valor_cents: valorCents,
    ativo: z.boolean(),
  })
  .strict()
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nada para alterar" });

/**
 * A venda. Com `produto_id`, o que não vier no corpo sai do catálogo; sem ele, das Regras da
 * clínica (sessões e validade do pacote padrão) e a modalidade é obrigatória.
 */
export const venderPacoteSchema = z
  .object({
    contact_id: z.string().uuid(),
    produto_id: z.string().uuid().optional(),
    modalidade: z.enum(MODALIDADES).optional(),
    nome: nome.optional(),
    sessoes: sessoes.optional(),
    validade_dias: validadeDias.optional(),
    valor_cents: valorCents.optional(),
    aceite_politica: z.literal(true, {
      error: "O paciente precisa aceitar a política de cancelamento antes da venda.",
    }),
  })
  .strict()
  .refine((v) => v.produto_id !== undefined || v.modalidade !== undefined, {
    message: "Escolha um pacote do catálogo ou informe a modalidade.",
  });

export const pacotesQuerySchema = z.object({
  contact_id: z.string().uuid().optional(),
  situacao: z.enum(SITUACOES_DO_PACOTE).optional(),
});

export const congelarPacoteSchema = z
  .object({ dias: z.number().int().min(1).max(180), motivo })
  .strict();

export const prorrogarPacoteSchema = z.object({ dias: validadeDias, motivo }).strict();

export const cancelarPacoteSchema = z
  .object({
    motivo,
    /** O reembolso combinado. Ausente: vale o sugerido (restantes pelo preço avulso). */
    reembolso_cents: valorCents.optional(),
  })
  .strict();
