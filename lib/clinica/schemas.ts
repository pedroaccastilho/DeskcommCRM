/** Validação (Zod) do que entra pelas rotas do módulo clínica. */
import { z } from "zod";

import { CARGOS, cargoDeSaudeDe, problemaNosCargos } from "@/lib/clinica/cargos";

import {
  CONSELHOS,
  MODALIDADES,
  TIPOS_DE_REGISTRO,
  UFS,
  camposObrigatoriosFaltando,
} from "@/lib/clinica/vocabulario";

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
  })
  .superRefine((v, ctx) => {
    const faltando = camposObrigatoriosFaltando(v.modalidade, v.tipo, v.conteudo);
    if (faltando.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["conteudo"],
        message: `Preencha antes de assinar: ${faltando.join(", ")}.`,
      });
    }
  });

/**
 * Os cargos escolhidos no cadastro do usuário (migration 9008): um de gestão e um de saúde no
 * máximo, ou só Recepção (`problemaNosCargos`). Com cargo de saúde, o registro do conselho vem
 * junto: nome como consta no conselho, número e UF. O conselho e as modalidades saem do cargo
 * (`lib/clinica/cargos.ts`), não do formulário.
 */
const registroDoConselho = {
  nome_profissional: z.string().trim().min(2).max(200).optional(),
  registro_numero: z.string().trim().min(1).max(30).optional(),
  registro_uf: z.enum(UFS).optional(),
};

const listaDeCargos = z.array(z.enum(CARGOS)).superRefine((cargos, ctx) => {
  const problema = problemaNosCargos(cargos);
  if (problema) ctx.addIssue({ code: "custom", message: problema });
});

export const definirCargosSchema = z.object({ cargos: listaDeCargos, ...registroDoConselho });
export type DefinirCargos = z.infer<typeof definirCargosSchema>;

export const convidarComCargosSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    cargos: listaDeCargos,
    ...registroDoConselho,
  })
  .refine(
    (v) =>
      !cargoDeSaudeDe(v.cargos) ||
      Boolean(v.nome_profissional && v.registro_numero && v.registro_uf),
    { message: "Para cargo de saúde, preencha o nome no conselho, o número e a UF do registro." },
  );
export type ConvidarComCargos = z.infer<typeof convidarComCargosSchema>;
