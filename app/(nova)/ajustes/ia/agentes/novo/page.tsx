import type { Metadata } from "next";

import Layout0 from "@/app/app/ai/layout";
import PaginaDaVersaoAtual from "@/app/app/ai/agents/new/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Novo agente" };

/**
 * `/app/ai/agents/new` dentro da interface nova (`lib/novo/ajustes.ts`).
 * Com os layouts de lá: são eles que recusam a tela com o módulo ou a capacidade desligado.
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
