/**
 * Os CARGOS aplicados no servidor (migration 9008): o que acontece quando o administrador escolhe
 * os cargos de alguém da equipe (ex.: Gerente + Fisioterapeuta), ou quando um convite com cargo
 * de saúde é aceito.
 *
 * Regra pura em `lib/clinica/cargos.ts`. Aqui só se grava, sempre com a organização da sessão
 * (nunca do corpo) e na ordem que deixa o estado coerente se algo falhar no meio: primeiro o
 * cadastro de profissional (que pode recusar por falta do registro), depois papel e menu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SAUDE_DO_CARGO,
  cargoDeSaudeDe,
  interfaceDosCargos,
  papelDosCargos,
  type CargoDeSaude,
  type CargoDoUsuario,
} from "./cargos";
import { moduloClinicaNaoInstalado } from "./api";

export interface RegistroDoConselho {
  nome_profissional?: string;
  registro_numero?: string;
  registro_uf?: string;
}

export type ResultadoDoCargo =
  | { ok: true; papelAntes: string; profissionalId: string | null }
  | {
      ok: false;
      status: number;
      code:
        | "not_found"
        | "state_conflict"
        | "validation_failed"
        | "module_not_installed"
        | "internal_error";
      message: string;
    };

interface ProfissionalExistente {
  id: string;
  conselho: string;
  nome_profissional: string;
  registro_numero: string;
  registro_uf: string;
  ativo: boolean;
}

/**
 * O registro completo para gravar: o que veio do formulário, completado pelo cadastro que a
 * pessoa já tinha no MESMO conselho (trocar só o cargo de quem já é fisioterapeuta não pede o
 * CREFITO de novo). `null` = falta dado.
 */
export function registroParaGravar(
  cargo: CargoDeSaude,
  enviado: RegistroDoConselho,
  existente: Pick<
    ProfissionalExistente,
    "conselho" | "nome_profissional" | "registro_numero" | "registro_uf"
  > | null,
): Required<RegistroDoConselho> | null {
  const base =
    existente && existente.conselho === SAUDE_DO_CARGO[cargo].conselho ? existente : null;
  const nome = enviado.nome_profissional ?? base?.nome_profissional;
  const numero = enviado.registro_numero ?? base?.registro_numero;
  const uf = enviado.registro_uf ?? base?.registro_uf;
  if (!nome || !numero || !uf) return null;
  return { nome_profissional: nome, registro_numero: numero, registro_uf: uf };
}

/**
 * Grava os perfis de alguém que JÁ é da equipe. `db` é o client da sessão do administrador: a RLS
 * de `clinica_profissionais` e de `user_organizations` cobra o mesmo degrau que a rota. `admin`
 * (service-role) só grava a lista de perfis, que nenhuma sessão escreve direto.
 */
export async function aplicarCargos(
  db: SupabaseClient,
  admin: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    cargos: CargoDoUsuario[];
    registro: RegistroDoConselho;
    definidoPor: string;
  },
): Promise<ResultadoDoCargo> {
  const { orgId, userId, cargos, registro } = params;
  const saude = cargoDeSaudeDe(cargos);

  const { data: vinculo, error: vinculoErro } = await db
    .from("user_organizations")
    .select("id, role, revoked_at")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (vinculoErro)
    return { ok: false, status: 500, code: "internal_error", message: vinculoErro.message };
  if (!vinculo) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "Essa pessoa não faz parte da equipe.",
    };
  }
  if (vinculo.revoked_at) {
    return {
      ok: false,
      status: 409,
      code: "state_conflict",
      message: "Essa pessoa foi removida da equipe.",
    };
  }

  const papelNovo = papelDosCargos(cargos);
  if (vinculo.role === "admin" && papelNovo !== "admin") {
    const { count, error } = await db
      .from("user_organizations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("role", "admin")
      .is("revoked_at", null);
    if (error) return { ok: false, status: 500, code: "internal_error", message: error.message };
    if ((count ?? 0) <= 1) {
      return {
        ok: false,
        status: 409,
        code: "state_conflict",
        message:
          "A clínica precisa de pelo menos um administrador. Escolha outro antes de trocar este.",
      };
    }
  }

  const { data: existente, error: lerErro } = await db
    .from("clinica_profissionais")
    .select("id, conselho, nome_profissional, registro_numero, registro_uf, ativo")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle<ProfissionalExistente>();
  if (lerErro) {
    if (moduloClinicaNaoInstalado(lerErro)) {
      return {
        ok: false,
        status: 409,
        code: "module_not_installed",
        message: "O módulo de clínica não está instalado.",
      };
    }
    return { ok: false, status: 500, code: "internal_error", message: lerErro.message };
  }

  let profissionalId: string | null = existente?.id ?? null;
  if (saude) {
    const completo = registroParaGravar(saude, registro, existente ?? null);
    if (!completo) {
      return {
        ok: false,
        status: 422,
        code: "validation_failed",
        message: "Para cargo de saúde, preencha o nome no conselho, o número e a UF do registro.",
      };
    }
    const linha = { ...completo, ...SAUDE_DO_CARGO[saude], ativo: true };
    const gravado = existente
      ? await db
          .from("clinica_profissionais")
          .update({ ...linha, updated_at: new Date().toISOString() })
          .eq("id", existente.id)
          .select("id")
          .single()
      : await db
          .from("clinica_profissionais")
          .insert({ organization_id: orgId, user_id: userId, ...linha })
          .select("id")
          .single();
    if (gravado.error) {
      return { ok: false, status: 500, code: "internal_error", message: gravado.error.message };
    }
    profissionalId = gravado.data.id as string;
  } else if (existente?.ativo) {
    // Desativar, nunca apagar: o cadastro é a origem da assinatura dos registros que já existem.
    const { error } = await db
      .from("clinica_profissionais")
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq("id", existente.id);
    if (error) return { ok: false, status: 500, code: "internal_error", message: error.message };
  }

  const { error: cargosErro } = await gravarCargosDoMembro(admin, {
    orgId,
    userId,
    cargos,
    definidoPor: params.definidoPor,
  });
  if (cargosErro)
    return { ok: false, status: 500, code: "internal_error", message: cargosErro.message };

  const { error: papelErro } = await db
    .from("user_organizations")
    .update({
      role: papelNovo,
      interface_settings: interfaceDosCargos(cargos),
      updated_at: new Date().toISOString(),
    })
    .eq("id", vinculo.id);
  if (papelErro)
    return { ok: false, status: 500, code: "internal_error", message: papelErro.message };

  return { ok: true, papelAntes: vinculo.role as string, profissionalId };
}

/**
 * Troca os perfis gravados de um membro pela lista nova. `admin` é o client service-role (só o
 * servidor escreve em `clinica_cargos_membro`); a organização vem da sessão de quem pediu.
 */
export async function gravarCargosDoMembro(
  admin: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    cargos: readonly CargoDoUsuario[];
    definidoPor: string | null;
  },
): Promise<{ error: { code?: string; message: string } | null }> {
  const { orgId, userId, cargos, definidoPor } = params;
  const apagado = await admin
    .from("clinica_cargos_membro")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .not("cargo", "in", `(${cargos.join(",")})`);
  if (apagado.error) return { error: apagado.error };
  const { error } = await admin.from("clinica_cargos_membro").upsert(
    cargos.map((cargo) => ({
      organization_id: orgId,
      user_id: userId,
      cargo,
      definido_por: definidoPor,
    })),
    { onConflict: "organization_id,user_id,cargo", ignoreDuplicates: true },
  );
  return { error };
}

/**
 * Guarda os perfis e o registro do conselho de um convite, até a pessoa aceitar. `admin` é o
 * client service-role; a organização vem da sessão de quem convidou.
 */
export async function guardarCargosDoConvite(
  admin: SupabaseClient,
  params: {
    inviteId: string;
    orgId: string;
    cargos: readonly CargoDoUsuario[];
    registro: RegistroDoConselho;
    criadoPor: string;
  },
): Promise<{ error: { code?: string; message: string } | null }> {
  const temSaude = Boolean(cargoDeSaudeDe(params.cargos));
  const { error } = await admin.from("clinica_convites_cargos").upsert(
    {
      invite_id: params.inviteId,
      organization_id: params.orgId,
      cargos: params.cargos,
      nome_profissional: temSaude ? (params.registro.nome_profissional ?? null) : null,
      registro_numero: temSaude ? (params.registro.registro_numero ?? null) : null,
      registro_uf: temSaude ? (params.registro.registro_uf ?? null) : null,
      criado_por: params.criadoPor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "invite_id" },
  );
  return { error };
}
