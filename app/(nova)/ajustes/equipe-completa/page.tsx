import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/team/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Equipe" };

/**
 * `/app/team` dentro da interface nova: o que a Equipe nova ainda não faz (revogar e devolver o
 * acesso de quem sai, reenviar e revogar convites, os horários de atendimento de cada
 * profissional). A Equipe nova (`/equipe`) aponta para cá; a página e os portões são os de lá.
 */
export default function Page({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  return (
    <CascaDoAjuste voltar={{ href: "/equipe", rotulo: "Equipe" }}>
      <PaginaDaVersaoAtual searchParams={searchParams} />
    </CascaDoAjuste>
  );
}
