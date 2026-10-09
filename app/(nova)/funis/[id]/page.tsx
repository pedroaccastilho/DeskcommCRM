import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/pipelines/[id]/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Funil" };

/** `/app/pipelines/[id]` dentro da interface nova: o quadro de um funil, com os leads dele. */
export default function Page(props: Parameters<typeof PaginaDaVersaoAtual>[0]) {
  return (
    <CascaDoAjuste voltar={{ href: "/funis", rotulo: "Leads" }}>
      <PaginaDaVersaoAtual {...props} />
    </CascaDoAjuste>
  );
}
