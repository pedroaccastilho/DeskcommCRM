import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/settings/conversoes/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conversões" };

/** `/app/settings/conversoes` dentro da interface nova (`lib/novo/ajustes.ts`). */
export default function Page(props: Parameters<typeof PaginaDaVersaoAtual>[0]) {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual {...props} />
    </CascaDoAjuste>
  );
}
