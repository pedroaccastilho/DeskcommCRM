import type { Metadata } from "next";

import Layout0 from "@/app/app/ai/layout";
import Layout1 from "@/app/app/ai/atendimento/layout";
import PaginaDaVersaoAtual from "@/app/app/ai/atendimento/[id]/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fluxo de atendimento" };

/**
 * `/app/ai/atendimento/[id]` dentro da interface nova (`lib/novo/ajustes.ts`).
 * Com os layouts de lá: são eles que recusam a tela com o módulo ou a capacidade desligado.
 */
export default function Page(props: Parameters<typeof PaginaDaVersaoAtual>[0]) {
  return (
    <CascaDoAjuste>
      <Layout0>
        <Layout1>
          <PaginaDaVersaoAtual {...props} />
        </Layout1>
      </Layout0>
    </CascaDoAjuste>
  );
}
