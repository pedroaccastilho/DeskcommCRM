/**
 * PRORROGAR UM PACOTE, com justificativa (módulo clínica, migration 9004).
 *
 * POST { dias, motivo } — a gerência (`manager`+). Sessão vencida não é devolvida, mas a gestão
 * pode estender a validade com justificativa (atestado, por exemplo). Pacote já vencido volta a
 * valer por `dias` a partir de hoje.
 */
import type { NextRequest } from "next/server";

import { ajustarPacoteNaRota } from "@/lib/clinica/pacotes-ajuste-rota";
import { prorrogarPacoteSchema } from "@/lib/clinica/pacotes-schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  return ajustarPacoteNaRota(req, context, {
    tipo: "prorrogacao",
    papel: "manager",
    schema: prorrogarPacoteSchema,
    acao: "clinica.pacote_prorrogado",
    preparar: async (corpo) => ({ dias: corpo.dias, motivo: corpo.motivo, valorCents: null }),
  });
}
