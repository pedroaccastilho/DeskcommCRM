import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { RelatorioDeOrigens } from "./_client";

export const dynamic = "force-dynamic";

/**
 * ORIGEM DOS PACIENTES — módulo opcional clínica (fork TOQ, migration 9005).
 *
 * De onde vieram os pacientes novos do período (WhatsApp, Instagram, indicação, encaminhamento
 * médico) e quantos compraram pacote, com o médico, o influenciador ou o anúncio por baixo.
 * Gerente para cima, como a rota: mostra valor vendido.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (!roleAtLeast(org.role, "manager")) redirect("/403");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Origem dos pacientes")}</h1>
        <p className="text-sm text-text-muted">
          {t("De onde vieram os pacientes novos do período e quantos deles compraram pacote.")}
        </p>
      </div>
      <RelatorioDeOrigens />
    </div>
  );
}
