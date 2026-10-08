import type { Metadata } from "next";

import Layout0 from "@/app/app/ai/layout";
import PaginaDaVersaoAtual from "@/app/app/ai/usage/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Uso e orçamento" };

/**
 * `/app/ai/usage` dentro da interface nova (`lib/novo/ajustes.ts`), com os layouts de lá: são eles que
 * recusam a tela quando o módulo ou a capacidade está desligado.
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
