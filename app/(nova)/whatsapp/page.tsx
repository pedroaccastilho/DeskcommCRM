import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ConversasDaClinica } from "@/components/novo/ConversasDaClinica";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { lerRascunho, type AvisoDeRascunho } from "@/lib/inbox/rascunho-sugerido";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "WhatsApp" };

/**
 * O WhatsApp da clínica DENTRO da interface nova. É a mesma caixa de entrada de `/app/inbox`
 * (mesmas rotas, mesmo tempo real, mesmo composer), vestida com a paleta da interface nova; por
 * isso `?id=` e `?rascunho=` valem aqui do mesmo jeito que lá.
 */
export default async function WhatsAppDaInterfaceNova({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; rascunho?: string }>;
}) {
  const user = await loadAuthUser();
  if (!user) redirect("/login?next=/whatsapp");
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const { id, rascunho } = await searchParams;
  // O mesmo recibo de `/app/inbox`: o rascunho sugerido é lido com a SESSÃO (RLS), e os recusos
  // (outra conversa, já usado, vencido) viram aviso em vez de sumir.
  let avisoDeRascunho: AvisoDeRascunho | null = null;
  if (rascunho && id) {
    const db = await createClient();
    avisoDeRascunho = {
      conversationId: id,
      leitura: await lerRascunho(db, {
        organizationId: org.orgId,
        conversationId: id,
        draftId: rascunho,
      }),
    };
  }
  return <ConversasDaClinica conversaInicial={id ?? null} rascunho={avisoDeRascunho} />;
}
