import type { Metadata } from "next";

import Layout0 from "@/app/app/ai/layout";
import Layout1 from "@/app/app/ai/atendimento/layout";
import PaginaDaVersaoAtual from "@/app/app/ai/atendimento/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Atendimento" };

/**
 * `/app/ai/atendimento` dentro da interface nova (`lib/novo/ajustes.ts`), com os layouts de lá: são eles que
 * recusam a tela quando o módulo ou a capacidade está desligado.
 */
export default function Page() {
  return (
    <CascaDoAjuste>
      <Layout0>
        <Layout1>
          <PaginaDaVersaoAtual />
        </Layout1>
      </Layout0>
    </CascaDoAjuste>
  );
}
