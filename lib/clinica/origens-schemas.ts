/** Validação (Zod) do que entra pelas rotas de origem do paciente (migration 9005). */
import { z } from "zod";

import { TIPOS_DE_ORIGEM } from "./origens";

/** Faixas iguais aos CHECK de `clinica_origens` e `clinica_pacientes_origem`. */
const nome = z.string().trim().min(2).max(60);
const ordem = z.number().int().min(0).max(1000);
const dia = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use a data no formato AAAA-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "data inválida");

export const origemSchema = z
  .object({
    nome,
    tipo: z.enum(TIPOS_DE_ORIGEM),
    ativo: z.boolean().default(true),
    ordem: ordem.default(100),
  })
  .strict();

/** O tipo não muda depois de criado: os pacientes já registrados contaram o que ele pedia. */
export const origemPatchSchema = z
  .object({ nome, ativo: z.boolean(), ordem })
  .strict()
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nada para alterar" });

export const origemDoPacienteSchema = z
  .object({
    origem_id: z.string().uuid(),
    detalhe: z.string().trim().max(200).nullish(),
    indicado_por_contact_id: z.string().uuid().nullish(),
  })
  .strict();

export const relatorioDeOrigensSchema = z
  .object({ de: dia.optional(), ate: dia.optional() })
  .refine((v) => !v.de || !v.ate || v.de <= v.ate, { message: "o início vem antes do fim" })
  .refine(
    (v) =>
      !v.de ||
      !v.ate ||
      Date.parse(`${v.ate}T00:00:00Z`) - Date.parse(`${v.de}T00:00:00Z`) <= 366 * 86_400_000,
    { message: "o período vai até um ano" },
  );
