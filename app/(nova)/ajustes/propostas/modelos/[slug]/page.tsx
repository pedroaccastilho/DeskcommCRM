import type { Metadata } from "next";

import Layout0 from "@/app/app/settings/tenant/proposals/layout";
import PaginaDaVersaoAtual from "@/app/app/settings/tenant/proposals/modelos/[slug]/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modelo de proposta" };

/**
 * `/app/settings/tenant/proposals/modelos/[slug]` dentro da interface nova (`lib/novo/ajustes.ts`).
 * Com os layouts de lá: são eles que recusam a tela com o módulo ou a capacidade desligado.
 */
export default function Page(props: Parameters<typeof PaginaDaVersaoAtual>[0]) {
  return (
    <CascaDoAjuste>
      <Layout0>
        <PaginaDaVersaoAtual {...props} />
      </Layout0>
    </CascaDoAjuste>
  );
}
