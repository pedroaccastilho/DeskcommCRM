/** Validação (Zod) do que entra pelas rotas do módulo clínica. */
import { z } from "zod";

import { CONSELHOS, MODALIDADES, TIPOS_DE_REGISTRO, UFS } from "@/lib/clinica/vocabulario";

export const profissionalSchema = z.object({
  nome_profissional: z.string().trim().min(2).max(200),
  conselho: z.enum(CONSELHOS),
  registro_numero: z.string().trim().min(1).max(30),
  registro_uf: z.enum(UFS),
  modalidades: z.array(z.enum(MODALIDADES)).min(1),
});

export const criarProfissionalSchema = profissionalSchema.extend({ user_id: z.string().uuid() });

export const editarProfissionalSchema = profissionalSchema
  .partial()
  .extend({ ativo: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "nada para alterar" });

/** Um valor do conteúdo estruturado: texto curto ou número. */
const valorDoCampo = z.union([z.string().max(5000), z.number().finite()]);

export const criarRegistroSchema = z
  .object({
    contact_id: z.string().uuid(),
    modalidade: z.enum(MODALIDADES),
    tipo: z.enum(TIPOS_DE_REGISTRO),
    appointment_id: z.string().uuid().nullish(),
    adendo_de: z.string().uuid().nullish(),
    conteudo: z.record(z.string().max(60), valorDoCampo).default({}),
    texto: z.string().max(20000).nullish(),
  })
  .refine((v) => (v.tipo === "adendo") === Boolean(v.adendo_de), {
    message: "Adendo precisa apontar o registro original, e só adendo aponta um.",
  });
