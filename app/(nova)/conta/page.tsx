import type { Metadata } from "next";

import { ProfileForm } from "@/app/app/settings/profile/_form";
import { CascaDaConta } from "@/components/novo/AbasDaConta";
import { requireAuth } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { normalizarIdioma } from "@/lib/i18n/idiomas";
import { SEM_PREFERENCIA_DE_IDIOMA } from "@/lib/schemas/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Minha conta" };

/**
 * O PERFIL na interface nova: o mesmo formulário de `/app/settings/profile` (nome, foto, idioma,
 * fuso). Lá está o porquê de o seletor mostrar a PREFERÊNCIA (`user.locale`) e não o idioma em uso.
 */
export default async function PerfilNaInterfaceNova() {
  const user = await requireAuth();
  const meta = user as unknown as {
    full_name: string | null;
    avatar_url: string | null;
    timezone?: string | null;
  };
  const idioma = user.idioma;
  return (
    <CascaDaConta
      titulo={traduzir("Perfil", idioma)}
      descricao={traduzir("Informações pessoais. Email só pode ser trocado em breve.", idioma)}
    >
      <ProfileForm
        email={user.email}
        initialFullName={meta.full_name}
        initialAvatarUrl={meta.avatar_url}
        initialLocale={user.locale ? normalizarIdioma(user.locale) : SEM_PREFERENCIA_DE_IDIOMA}
        initialTimezone={meta.timezone ?? "America/Sao_Paulo"}
      />
    </CascaDaConta>
  );
}
