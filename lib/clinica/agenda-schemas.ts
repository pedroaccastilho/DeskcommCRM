/** Validação (Zod) do que entra pelas rotas da agenda da clínica (migration 9002). */
import { z } from "zod";

import { MODALIDADES } from "@/lib/clinica/vocabulario";

const DIA_MS = 24 * 60 * 60 * 1000;
/** A grade cobre no máximo um mês por pedido. */
export const JANELA_MAXIMA_DA_GRADE_DIAS = 31;

/** "a,b,c" → ["a","b","c"]; ausente → []. */
const separadaPorVirgula = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));

export const gradeQuerySchema = z
  .object({
    de: z.string().datetime({ offset: true }),
    ate: z.string().datetime({ offset: true }),
    profissional: separadaPorVirgula.pipe(z.array(z.string().uuid()).max(50)),
    modalidade: separadaPorVirgula.pipe(z.array(z.enum(MODALIDADES)).max(4)),
    incluir_canceladas: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((v) => v === "true" || v === "1"),
  })
  .refine((q) => new Date(q.ate).getTime() > new Date(q.de).getTime(), {
    message: "`ate` precisa ser depois de `de`.",
  })
  .refine(
    (q) =>
      new Date(q.ate).getTime() - new Date(q.de).getTime() <= JANELA_MAXIMA_DA_GRADE_DIAS * DIA_MS,
    { message: `A grade cobre no máximo ${JANELA_MAXIMA_DA_GRADE_DIAS} dias por pedido.` },
  );

export const aConfirmarQuerySchema = z.object({
  horas: z.coerce.number().int().min(1).max(168).default(48),
});

export const politicaSchema = z
  .object({
    antecedencia_cancelamento_horas: z.number().int().min(0).max(168),
    multa_cancelamento_pct: z.number().int().min(0).max(100),
    tolerancia_atraso_minutos: z.number().int().min(0).max(120),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nada para alterar" });

export const tipoAtendimentoSchema = z.object({
  event_type_id: z.string().uuid(),
  /** `null` tira a etiqueta: o tipo deixa de ser sessão da clínica. */
  modalidade: z.enum(MODALIDADES).nullable(),
  valor_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

export const multasQuerySchema = z.object({
  status: z.enum(["pendente", "isenta", "paga"]).optional(),
  contact_id: z.string().uuid().optional(),
});

export const isentarMultaSchema = z.object({
  motivo: z.string().trim().min(3).max(1000),
});

export const cancelarSessaoSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
  /** `true` quando a clínica desmarcou (profissional doente, sala indisponível): não gera multa. */
  pela_clinica: z.boolean().default(false),
  revision: z.number().int().positive().optional(),
});
