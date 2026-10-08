import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/settings/tenant/pipelines/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Etapas do funil" };

/** `/app/settings/tenant/pipelines` dentro da interface nova (`lib/novo/ajustes.ts`). */
export default function Page() {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual />
    </CascaDoAjuste>
  );
}
