import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/settings/tenant/clinica/regras/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Regras da clínica" };

/** `/app/settings/tenant/clinica/regras` dentro da interface nova (`lib/novo/ajustes.ts`). */
export default function Page() {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual />
    </CascaDoAjuste>
  );
}
