import type { Metadata } from "next";

import PaginaDaVersaoAtual from "@/app/app/kanban/page";
import { CascaDoAjuste } from "@/components/novo/CascaDoAjuste";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leads" };

/**
 * LEADS: os funis de venda da versão atual (`/app/kanban`) dentro da interface nova, com porta no
 * menu de Recepção e Gestão (`menuDoCargo`). É a MESMA página de lá, com os mesmos portões de
 * papel (criar e configurar funil seguem de Gerente para cima); os links para o quadro de cada
 * funil e para um negócio ficam aqui (`lib/novo/ajustes.ts`).
 */
export default function Page() {
  return (
    <CascaDoAjuste voltar={null}>
      <PaginaDaVersaoAtual />
    </CascaDoAjuste>
  );
}
