import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { telaDeLgpdLiberada } from "@/lib/clinica/gestao-servidor";
import { traduzir } from "@/lib/i18n/dicionario";
import { RequestsTable } from "./RequestsTable";

export const dynamic = "force-dynamic";

export default async function LgpdRequestsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) redirect("/app");

  // Administrador (ou platform admin) e o perfil Jurídico (`telaDeLgpdLiberada`).
  const isAllowed = await telaDeLgpdLiberada(user, activeOrg);
  if (!isAllowed) redirect("/app");

  const idioma = user.idioma;
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Solicitações LGPD")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Anonimizações e solicitações de dados de titulares. Só o Administrador e o Jurídico.")}
        </p>
      </header>
      <RequestsTable />
    </div>
  );
}
