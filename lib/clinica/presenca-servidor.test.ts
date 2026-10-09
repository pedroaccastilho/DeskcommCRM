/**
 * A trava no servidor: confirmar, "Realizado" e "Faltou" pelo handler da agenda (o mesmo da tela
 * e do MCP) só para o profissional da sessão, a Recepção, o Gerente e o Administrador.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";
import { antesDeMarcarPresenca } from "@/lib/agenda/regras-de-modulo";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

function banco(tabelas: Record<string, unknown>): SupabaseClient {
  return {
    from: (t: string) => {
      const r = { data: tabelas[t] ?? [], error: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) q[m] = () => q;
      q.maybeSingle = async () => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: null,
      });
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok);
      return q;
    },
  } as unknown as SupabaseClient;
}

const FISIO = "11111111-1111-4111-8111-111111111111";
const MEDICA = "22222222-2222-4222-8222-222222222222";
const daClinica = { clinica_tipos_atendimento: { modalidade: "fisioterapia" } };

function ctxDe(id: string, type: "user" | "ai_agent" = "user"): HandlerCtx {
  return { organization_id: "org-1", requestId: "req-1", actor: { type, id } } as HandlerCtx;
}

function perfis(role: string, cargos: string[]) {
  vi.mocked(createAdminClient).mockReturnValue(
    banco({
      user_organizations: { role },
      clinica_profissionais: null,
      clinica_cargos_membro: cargos.map((cargo) => ({ cargo })),
    }) as never,
  );
}

const sessaoDaFisio = { eventTypeId: "tipo-fisio", donoId: FISIO };

beforeEach(() => vi.clearAllMocks());

describe("antesDeMarcarPresenca — a sessão é da agenda de quem marca?", () => {
  it("a fisioterapeuta registra a própria sessão", async () => {
    perfis("agent", ["fisioterapeuta"]);
    await expect(
      antesDeMarcarPresenca(banco(daClinica), ctxDe(FISIO), sessaoDaFisio),
    ).resolves.toBeUndefined();
  });

  it("a médica não registra a sessão da fisioterapeuta: 403 com código próprio", async () => {
    perfis("agent", ["medico"]);
    const erro = await antesDeMarcarPresenca(banco(daClinica), ctxDe(MEDICA), sessaoDaFisio).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(403);
    expect((erro as ApiError).code).toBe("clinica_sessao_de_outro_profissional");
  });

  it("recepção e gerente registram a de todos", async () => {
    for (const [role, cargos] of [
      ["agent", ["recepcao"]],
      ["manager", ["gerente"]],
    ] as const) {
      perfis(role, [...cargos]);
      await expect(
        antesDeMarcarPresenca(banco(daClinica), ctxDe(MEDICA), sessaoDaFisio),
      ).resolves.toBeUndefined();
    }
  });

  it("o Financeiro (papel de gerente no núcleo) não registra a sessão alheia", async () => {
    perfis("manager", ["financeiro"]);
    await expect(
      antesDeMarcarPresenca(banco(daClinica), ctxDe(MEDICA), sessaoDaFisio),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("compromisso que não é da clínica segue a regra do núcleo", async () => {
    perfis("agent", ["medico"]);
    await expect(
      antesDeMarcarPresenca(banco({ clinica_tipos_atendimento: null }), ctxDe(MEDICA), sessaoDaFisio),
    ).resolves.toBeUndefined();
  });

  it("o agente de IA não é recortado por dono (o papel do token governa)", async () => {
    perfis("agent", []);
    await expect(
      antesDeMarcarPresenca(banco(daClinica), ctxDe("run-1", "ai_agent"), sessaoDaFisio),
    ).resolves.toBeUndefined();
  });
});
