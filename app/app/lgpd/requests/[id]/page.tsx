import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { telaDeLgpdLiberada } from "@/lib/clinica/gestao-servidor";
import { LgpdRequestDetail } from "./_client";

export const dynamic = "force-dynamic";

export default async function LgpdRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);

  if (!activeOrg) redirect("/app");

  // Administrador (ou platform admin) e o perfil Jurídico (`telaDeLgpdLiberada`).
  const isAllowed = await telaDeLgpdLiberada(user, activeOrg);
  if (!isAllowed) redirect("/app");

  return (
    <div className="flex h-full flex-col gap-0 p-6">
      <LgpdRequestDetail id={id} />
    </div>
  );
}
