import type { Metadata } from "next";

import Layout0 from "@/app/app/settings/tenant/proposals/layout";
import PaginaDaVersaoAtual from "@/app/app/settings/tenant/proposals/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Propostas" };

/**
 * `/app/settings/tenant/proposals` dentro da interface nova (`lib/novo/ajustes.ts`), com os layouts de lá: são eles que
 * recusam a tela quando o módulo ou a capacidade está desligado.
 */
export default function Page() {
  return (
    <CascaDoAjuste>
      <Layout0>
        <PaginaDaVersaoAtual />
      </Layout0>
    </CascaDoAjuste>
  );
}
