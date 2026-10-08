/**
 * O MÓDULO CLÍNICA PARA QUEM ESTÁ LOGADO: está instalado? sou profissional de saúde aqui? quais
 * são os meus perfis (migration 9008)?
 *
 * É o que a ficha do paciente pergunta para decidir se mostra a aba "Prontuário" e se mostra o
 * formulário de registro. Não decide acesso: quem decide é a RLS (fn_clinica_e_profissional).
 *
 * Com o "entrar como" ligado (`lib/clinica/ver-como.ts`), responde pela pessoa que o
 * administrador escolheu: papel, perfis e cadastro dela, e `vendo_como` com quem é. A interface
 * nova monta a tela a partir disso; a sessão e a RLS continuam sendo as do administrador.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { cargosDoUsuario } from "@/lib/clinica/cargos";
import { veLgpdEAcessos } from "@/lib/clinica/gestao";
import { lerVerComo, verComoValido } from "@/lib/clinica/ver-como";
import type { Role } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_profissionais" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const verComo = authz.user.support
    ? null
    : verComoValido(await lerVerComo(), authz.user);
  const alvo = verComo && verComo.orgId === authz.org.orgId ? verComo.userId : null;

  let papel: Role = authz.org.role;
  let vendo_como: { user_id: string; nome: string; email: string | null } | null = null;
  if (alvo) {
    const { data: vinculo } = await supabase
      .from("user_organizations")
      .select("role, revoked_at")
      .eq("organization_id", authz.org.orgId)
      .eq("user_id", alvo)
      .maybeSingle();
    if (vinculo && !vinculo.revoked_at) {
      papel = vinculo.role as Role;
      const { data: pessoa } = await createAdminClient().auth.admin.getUserById(alvo);
      const email = pessoa?.user?.email ?? null;
      const nome =
        (pessoa?.user?.user_metadata?.full_name as string | undefined) ??
        email?.split("@")[0] ??
        "—";
      vendo_como = { user_id: alvo, nome, email };
    }
  }
  const quem = vendo_como?.user_id ?? authz.user.id;

  const { data, error } = await supabase
    .from("clinica_profissionais")
    .select("id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", quem)
    .maybeSingle();

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return ok(
        { instalado: false, profissional: null, ve_acessos: false, cargos: [], papel, vendo_como },
        { requestId },
      );
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  // Os perfis de quem está logado (migration 9008): os gravados ou, sem nenhum, os calculados.
  // Sem a 9008 a tabela não existe; aí valem os calculados.
  const gravados = await supabase
    .from("clinica_cargos_membro")
    .select("cargo")
    .eq("organization_id", authz.org.orgId)
    .eq("user_id", quem);
  if (gravados.error && !moduloClinicaNaoInstalado(gravados.error)) {
    return fail("internal_error", gravados.error.message, 500, { requestId });
  }
  const cargos = cargosDoUsuario(
    papel,
    data,
    (gravados.data ?? []).map((g) => g.cargo as string),
  );

  // Sessão de suporte nunca lê prontuário (a RLS garante); a tela já não oferece o formulário.
  const profissional = data && data.ativo && !authz.user.support ? data : null;
  // A trilha de acessos é do administrador da clínica, seja ele profissional de saúde ou não, e do
  // perfil Jurídico (`veLgpdEAcessos`; a rota `/clinica/acessos` aplica a mesma regra). Sessão de
  // suporte não vê.
  const ve_acessos = veLgpdEAcessos(papel, cargos) && !authz.user.support;
  return ok({ instalado: true, profissional, ve_acessos, cargos, papel, vendo_como }, { requestId });
}
