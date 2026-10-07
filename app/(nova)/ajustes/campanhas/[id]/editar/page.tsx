import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/campaigns/[id]/edit/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editar campanha" };

/**
 * `/app/campaigns/[id]/edit` dentro da interface nova (`lib/novo/ajustes.ts`).
 */
export default function Page(props: Parameters<typeof PaginaDaVersaoAtual>[0]) {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual {...props} />
    </CascaDoAjuste>
  );
}
