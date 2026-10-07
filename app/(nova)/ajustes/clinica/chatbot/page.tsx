import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/settings/tenant/clinica/chatbot/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chatbot" };

/** `/app/settings/tenant/clinica/chatbot` dentro da interface nova (`lib/novo/ajustes.ts`). */
export default function Page() {
  return (
    <CascaDoAjuste>
      <PaginaDaVersaoAtual />
    </CascaDoAjuste>
  );
}
