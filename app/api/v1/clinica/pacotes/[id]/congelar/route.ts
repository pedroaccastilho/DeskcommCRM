/**
 * CONGELAR UM PACOTE por viagem ou afastamento (módulo clínica, migration 9004).
 *
 * POST { dias, motivo } — a recepção (`agent`+). Uma vez por pacote, até o máximo das Regras da
 * clínica (30 dias no padrão), e só pacote ainda válido. A validade anda os dias congelados.
 */
import type { NextRequest } from "next/server";

import { ajustarPacoteNaRota } from "@/lib/clinica/pacotes-ajuste-rota";
import { congelarPacoteSchema } from "@/lib/clinica/pacotes-schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  return ajustarPacoteNaRota(req, context, {
    tipo: "congelamento",
    papel: "agent",
    schema: congelarPacoteSchema,
    acao: "clinica.pacote_congelado",
    preparar: async (corpo) => ({ dias: corpo.dias, motivo: corpo.motivo, valorCents: null }),
  });
}
