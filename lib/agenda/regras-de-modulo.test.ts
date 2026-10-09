import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";

import { antesDeOcupar } from "./regras-de-modulo";

/** Banco de mentira por tabela; `quebra` faz a leitura da tabela lançar (rede, pool). */
function banco(
  tabelas: Record<string, { data: unknown; error?: unknown }>,
  quebra?: string,
): SupabaseClient {
  return {
    from: (t: string) => {
      if (t === quebra) throw new Error("rede caiu");
      const r = { data: tabelas[t]?.data ?? [], error: tabelas[t]?.error ?? null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "lt", "gt", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: r.error,
      });
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(r).then(ok, falha);
      return q;
    },
  } as unknown as SupabaseClient;
}

const ctx = { organization_id: "org-1", requestId: "req-1" } as unknown as HandlerCtx;
const pedido = {
  eventTypeId: "tipo-medico",
  contactId: "ana",
  inicio: new Date("2026-10-12T12:00:00Z"),
  fim: new Date("2026-10-12T13:00:00Z"),
};
const comChoque = {
  clinica_tipos_atendimento: { data: { modalidade: "medicina" } },
  calendar_appointments: {
    data: [
      {
        id: "ap-fisio",
        starts_at: "2026-10-12T12:00:00Z",
        ends_at: "2026-10-12T13:00:00Z",
        status: "confirmed",
        time_zone: "America/Sao_Paulo",
        owner_user_id: null,
        event_type_id: null,
        title: "Fisioterapia",
      },
    ],
  },
};

describe("antesDeOcupar — o ponto do módulo antes de um compromisso ocupar o horário", () => {
  it("a recusa do módulo (ApiError) chega a quem marcou", async () => {
    const erro = await antesDeOcupar(banco(comChoque), ctx, pedido).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).code).toBe("agenda_paciente_ocupado");
  });

  it("não conseguir LER a regra do módulo não trava a agenda do núcleo", async () => {
    await expect(
      antesDeOcupar(banco(comChoque, "calendar_appointments"), ctx, pedido),
    ).resolves.toBeUndefined();
  });
});
