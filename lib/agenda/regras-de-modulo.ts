/**
 * O PONTO DE EXTENSÃO DA AGENDA PARA MÓDULOS (ADR-0002) — hoje, só o módulo clínica.
 *
 * O handler da agenda (`app/api/v1/agenda/agendamentos/_handler.ts`) chama estas duas funções e
 * mais nada do módulo. Sem o módulo instalado, as duas não fazem nada: a agenda do núcleo segue
 * inteira (DoD 18, destino "ambos": o núcleo ganha o ponto, o módulo é o consumidor).
 *
 * - `antesDoDesfecho` pode RECUSAR (ApiError com código próprio). É a única que pode.
 * - `depoisDaMudanca` nunca lança: o compromisso já está gravado, e falhar aqui não pode
 *   devolver erro a quem cancelou ou remarcou.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import {
  antesDoDesfechoNaClinica,
  depoisDaMudancaNaClinica,
  type MudancaNaAgenda,
} from "@/lib/clinica/regras-da-agenda";
import { ApiError } from "@/lib/api/types";
import { logger } from "@/lib/logger";

export type { MudancaNaAgenda };

export async function antesDoDesfecho(
  db: SupabaseClient,
  ctx: HandlerCtx,
  compromisso: { eventTypeId: string | null; inicio: Date; status: string },
): Promise<void> {
  try {
    await antesDoDesfechoNaClinica(db, ctx, compromisso);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Não conseguir LER a regra do módulo não trava a agenda do núcleo.
    logger.error("[agenda] regra de módulo antes do desfecho não pôde ser lida", {
      organization_id: ctx.organization_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function depoisDaMudanca(
  db: SupabaseClient,
  ctx: HandlerCtx,
  mudanca: MudancaNaAgenda,
): Promise<void> {
  try {
    await depoisDaMudancaNaClinica(db, ctx, mudanca);
  } catch (err) {
    logger.error("[agenda] regra de módulo depois da mudança falhou", {
      organization_id: ctx.organization_id,
      appointment_id: mudanca.appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
