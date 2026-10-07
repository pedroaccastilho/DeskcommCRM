import type { Metadata } from "next";

import { SecurityClient } from "@/app/app/settings/security/_client";
import { CascaDaConta } from "@/components/novo/AbasDaConta";
import { empresaExigeMfa } from "@/lib/auth/politica-mfa";
import { isMfaEnrolled, requireAuth, requiresMfa, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Segurança" };

/**
 * A SEGURANÇA na interface nova: a mesma tela de `/app/settings/security` (verificação em duas
 * etapas, códigos de recuperação, sair de todos os aparelhos), com as mesmas leituras — a regra do
 * "é obrigatório" é a do layout (`requiresMfa`), nunca uma segunda.
 */
export default async function SegurancaNaInterfaceNova() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  const enrolled = await isMfaEnrolled();

  let empresaExige = false;
  if (org) {
    const { data } = await createAdminClient()
      .from("organizations")
      .select("settings")
      .eq("id", org.orgId)
      .maybeSingle();
    empresaExige = empresaExigeMfa(data?.settings);
  }
  const obrigatorio = await requiresMfa(org?.role, user.is_platform_admin, user.id, org?.orgId);
  const idioma = user.idioma;

  return (
    <CascaDaConta
      titulo={traduzir("Segurança", idioma)}
      descricao={traduzir(
        "A verificação em duas etapas da sua conta, os códigos de recuperação e as sessões abertas.",
        idioma,
      )}
    >
      <SecurityClient
        mfaEnrolled={enrolled}
        obrigatorio={obrigatorio}
        podeExigirDaEquipe={org?.role === "admin"}
        empresaExige={empresaExige}
      />
    </CascaDaConta>
  );
}
