/**
 * Pedaços comuns às rotas do módulo clínica (ADR-0002, migration 9001).
 *
 * Antes de o módulo ser instalado as tabelas não existem e o Postgres devolve 42P01; as rotas
 * traduzem isso numa mensagem clara, nunca num 500 cru (mesmo padrão de honorários).
 */
import { fail } from "@/lib/api/wrappers";

export const MODULO_CLINICA_NAO_INSTALADO =
  "O módulo de clínica não está instalado nesta instalação. Peça ao administrador para " +
  "instalar em Configurações da instalação › Módulos.";

export function moduloClinicaNaoInstalado(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

/** Os erros com nome que os gatilhos do prontuário levantam, em linguagem de quem usa. */
const RECUSAS_DO_PRONTUARIO: Record<string, string> = {
  prontuario_sem_cadastro_de_profissional:
    "Só profissional de saúde cadastrado e ativo na clínica registra no prontuário.",
  prontuario_modalidade_fora_do_cadastro:
    "Essa modalidade não está no seu cadastro de profissional.",
  prontuario_autor_nao_e_quem_assina: "O registro só pode ser assinado por quem está logado.",
  prontuario_contato_de_outra_organizacao: "Paciente inválido para esta clínica.",
  prontuario_compromisso_nao_e_do_paciente: "Essa sessão da agenda não é deste paciente.",
  prontuario_adendo_de_outro_paciente: "O adendo precisa apontar um registro do mesmo paciente.",
  prontuario_registro_imutavel: "Registro assinado não se edita nem se apaga. Crie um adendo.",
};

/** Traduz um erro do banco ao gravar no prontuário em resposta da API. */
export function falhaDoProntuario(
  error: { code?: string; message?: string },
  requestId: string,
): Response {
  if (moduloClinicaNaoInstalado(error)) {
    return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
  }
  const recusa = Object.keys(RECUSAS_DO_PRONTUARIO).find((k) => error.message?.includes(k));
  if (recusa) return fail("forbidden", RECUSAS_DO_PRONTUARIO[recusa]!, 403, { requestId });
  if (error.code === "42501") {
    return fail("forbidden", RECUSAS_DO_PRONTUARIO.prontuario_sem_cadastro_de_profissional!, 403, {
      requestId,
    });
  }
  if (error.code === "23514") {
    return fail("validation_failed", "Registro incompleto: preencha ao menos um campo.", 422, {
      requestId,
    });
  }
  return fail("internal_error", error.message ?? "erro ao gravar no prontuário", 500, {
    requestId,
  });
}
