import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/lgpd/requests/[id]/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Solicitação LGPD" };

/**
 * `/app/lgpd/requests/[id]` dentro da interface nova (`lib/novo/ajustes.ts`).
 */
export default function Page(props: Parameters<typeof PaginaDaVersaoAtual>[0]) {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual {...props} />
    </CascaDoAjuste>
  );
}
