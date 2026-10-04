import localFont from "next/font/local";
import { redirect } from "next/navigation";

import { Casca } from "@/components/novo/Casca";
import { AuthProvider } from "@/hooks/auth/AuthProvider";
import { isMfaEnrolled, loadAuthUser, requiresMfa, resolveActiveOrg } from "@/lib/auth/server";
import { marcaDaInstalacao } from "@/lib/branding/instalacao";
import { resolverMarcaDaOrganizacao } from "@/lib/branding/organizacao";
import { env } from "@/lib/env";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { ehOperante } from "@/lib/organizacao/operante";
import { createAdminClient } from "@/lib/supabase/admin";
import { fusoUtilizavel } from "@/lib/tempo/fusos";

import "./novo.css";

/**
 * A INTERFACE NOVA (`/novo`) — teste A/B da TOQ, módulo clínica.
 *
 * Uma segunda casca sobre o MESMO backend: mesmo login, mesmas rotas `/api/v1`, mesma RLS. Nada
 * aqui substitui a interface de `/app`, que segue intacta; o dono compara as duas lado a lado.
 *
 * Os portões são os mesmos de `/app/layout.tsx` (login, organização, suspensão, onboarding,
 * MFA). Quando um deles precisa de tela própria, a pessoa é mandada para `/app`, que já sabe
 * desenhá-la — a interface nova não duplica telas de exceção.
 */
const display = localFont({
  src: [{ path: "../fonts/fraunces-100-900-latin.woff2", weight: "100 900", style: "normal" }],
  display: "swap",
  variable: "--novo-fonte-titulo",
});

const texto = localFont({
  src: [
    { path: "../fonts/plus-jakarta-sans-200-800-latin.woff2", weight: "200 800", style: "normal" },
  ],
  display: "swap",
  variable: "--novo-fonte-texto",
});

export const dynamic = "force-dynamic";

export const metadata = { title: "TOQ" };

export default async function LayoutDaInterfaceNova({ children }: { children: React.ReactNode }) {
  const user = await loadAuthUser();
  if (!user) redirect("/login?next=/novo");

  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const admin = createAdminClient();
  const [orgRes, modulos, enrolled, mfaExigido] = await Promise.all([
    admin
      .from("organizations")
      .select("onboarded_at, status, settings")
      .eq("id", org.orgId)
      .maybeSingle(),
    modulosLigados(admin),
    isMfaEnrolled(),
    requiresMfa(org.role, user.is_platform_admin, user.id, org.orgId),
  ]);
  if (orgRes.error) throw new Error(`organizacao_ilegivel: ${orgRes.error.message}`);
  if (!ehOperante(orgRes.data?.status)) redirect("/account-suspended");
  if (orgRes.data && !orgRes.data.onboarded_at && !user.support) redirect("/onboarding");
  // O cadastro do segundo fator é uma tela da interface atual; quem precisa dele passa por lá.
  if (mfaExigido && !enrolled) redirect("/app");

  const marca = resolverMarcaDaOrganizacao(
    orgRes.data?.settings ?? null,
    await marcaDaInstalacao(),
    env,
  );
  const activeOrg = { ...org, modulos_ligados: modulos };
  const fuso = fusoUtilizavel(org.timezone);

  return (
    <IdiomaProvider locale={user.idioma}>
      <AuthProvider user={user} activeOrg={activeOrg}>
        <div className={`novo ${display.variable} ${texto.variable}`} data-interface="novo">
          <Casca
            fuso={fuso}
            marca={{ nome: marca.name, logoUrl: marca.logoUrl ?? null }}
            clinicaInstalada={modulos.includes("clinica")}
          >
            {children}
          </Casca>
        </div>
      </AuthProvider>
    </IdiomaProvider>
  );
}
