import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";

import { EvolucoesPendentes } from "./_client";

export const dynamic = "force-dynamic";

/**
 * EVOLUÇÕES PENDENTES — módulo opcional clínica (fork TOQ).
 *
 * As sessões que a pessoa atendeu nos últimos 30 dias e ainda não têm registro no prontuário.
 * É o laço de volta da agenda: sessão que aconteceu e não foi registrada não some, fica aqui
 * até alguém assinar a evolução.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Evoluções pendentes")}</h1>
        <p className="text-sm text-text-muted">
          {t(
            "Sessões que você atendeu nos últimos 30 dias e que ainda não têm registro no prontuário.",
          )}
        </p>
      </div>
      <EvolucoesPendentes />
    </div>
  );
}
