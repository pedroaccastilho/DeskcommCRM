import type { Metadata } from "next";

import { NotificationPrefsClient } from "@/app/app/settings/notifications/_client";
import { SonsDosAvisos } from "@/app/app/settings/notifications/_sons";
import { CascaDaConta } from "@/components/novo/AbasDaConta";
import { requireAuth } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { vapidPronto } from "@/lib/notifications/vapid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avisos" };

/**
 * OS AVISOS na interface nova: as mesmas escolhas de `/app/settings/notifications` (canais,
 * categorias e sons). O recado sobre o Push sem as chaves VAPID é o de lá, resumido: quem usa a
 * interface nova não administra o servidor, então ela diz o que acontece e quem resolve.
 */
export default async function AvisosNaInterfaceNova() {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const pushPronto = vapidPronto();

  return (
    <CascaDaConta titulo={t("Avisos")} descricao={t("Canais e categorias.")}>
      {!pushPronto && (
        <p className="n-cartao p-4 text-sm" data-testid="push-status-faltando-chaves">
          {t("Nesta instalação, os avisos só aparecem com o site aberto.")}
        </p>
      )}
      <NotificationPrefsClient />
      <SonsDosAvisos />
    </CascaDaConta>
  );
}
