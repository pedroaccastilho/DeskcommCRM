import type { Metadata } from "next";

import Layout0 from "@/app/app/imports/layout";
import PaginaDaVersaoAtual from "@/app/app/imports/[id]/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Importação" };

/**
 * `/app/imports/[id]` dentro da interface nova (`lib/novo/ajustes.ts`).
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
