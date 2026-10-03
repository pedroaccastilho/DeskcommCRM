/**
 * CANCELAR UM PACOTE (módulo clínica, migration 9004).
 *
 * POST { motivo, reembolso_cents? } — a gerência (`manager`+). O reembolso sugerido é o das
 * sessões restantes pelo preço AVULSO da modalidade (o "Preço padrão" dos tipos de agendamento),
 * sem passar do que foi pago. Sem preço avulso definido, só vale o que a gerência informar. O
 * valor fica no evento do cancelamento; devolver o dinheiro é fora do sistema (por enquanto).
 */
import type { NextRequest } from "next/server";

import { reembolsoSugerido, saldoDoPacote } from "@/lib/clinica/pacotes";
import { ajustarPacoteNaRota } from "@/lib/clinica/pacotes-ajuste-rota";
import { cancelarPacoteSchema } from "@/lib/clinica/pacotes-schemas";
import { precoAvulsoDaModalidade } from "@/lib/clinica/pacotes-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  return ajustarPacoteNaRota(req, context, {
    tipo: "cancelamento",
    papel: "manager",
    schema: cancelarPacoteSchema,
    acao: "clinica.pacote_cancelado",
    preparar: async (corpo, pacote, admin, org) => {
      if (corpo.reembolso_cents !== undefined) {
        return { dias: null, motivo: corpo.motivo, valorCents: corpo.reembolso_cents };
      }
      const usadas = Number(pacote.clinica_pacote_consumos?.[0]?.count ?? 0);
      return {
        dias: null,
        motivo: corpo.motivo,
        valorCents: reembolsoSugerido({
          restantes: saldoDoPacote({ sessoes_total: pacote.sessoes_total, sessoes_usadas: usadas }),
          precoAvulsoCents: await precoAvulsoDaModalidade(admin, org, pacote.modalidade),
          valorPagoCents: pacote.valor_cents === null ? null : Number(pacote.valor_cents),
        }),
      };
    },
  });
}
