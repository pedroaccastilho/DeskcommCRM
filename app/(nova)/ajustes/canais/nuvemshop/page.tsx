import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/integrations/nuvemshop/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Nuvemshop" };

/** `/app/integrations/nuvemshop` dentro da interface nova (`lib/novo/ajustes.ts`). */
export default function Page() {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual />
    </CascaDoAjuste>
  );
}
