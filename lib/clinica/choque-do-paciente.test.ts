import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { HandlerCtx } from "@/lib/api/handlers/types";
import { ApiError } from "@/lib/api/types";

import { cruzaComAlguma, fraseDoChoque, sessaoQueChoca } from "./choque-do-paciente";
import { pacienteLivreNaClinica } from "./regras-da-agenda";

const h = (iso: string) => new Date(`2026-10-12T${iso}:00-03:00`); // segunda, Brasília
const sessao = (id: string, de: string, ate: string, status = "confirmed") => ({
  id,
  inicio: h(de),
  fim: h(ate),
  status,
});

describe("o paciente não está em dois lugares ao mesmo tempo", () => {
  const ana = [sessao("fisio", "09:00", "10:00")];

  it("mesmo horário com outro profissional cruza", () => {
    expect(sessaoQueChoca(ana, { inicio: h("09:00"), fim: h("09:30") })?.id).toBe("fisio");
  });

  it("sobrepor em parte também cruza, e não só começar na mesma hora", () => {
    expect(cruzaComAlguma(ana, { inicio: h("09:30"), fim: h("10:30") })).toBe(true);
    expect(cruzaComAlguma(ana, { inicio: h("08:30"), fim: h("09:15") })).toBe(true);
  });

  it("encostar não cruza: uma termina às 10:00, a outra começa às 10:00", () => {
    expect(cruzaComAlguma(ana, { inicio: h("10:00"), fim: h("11:00") })).toBe(false);
    expect(cruzaComAlguma(ana, { inicio: h("08:00"), fim: h("09:00") })).toBe(false);
  });

  it("sessão desmarcada ou falta libera o horário", () => {
    expect(
      cruzaComAlguma([sessao("x", "09:00", "10:00", "cancelled")], {
        inicio: h("09:00"),
        fim: h("10:00"),
      }),
    ).toBe(false);
    expect(
      cruzaComAlguma([sessao("x", "09:00", "10:00", "no_show")], {
        inicio: h("09:00"),
        fim: h("10:00"),
      }),
    ).toBe(false);
    expect(
      cruzaComAlguma([sessao("x", "09:00", "10:00", "pending")], {
        inicio: h("09:00"),
        fim: h("10:00"),
      }),
    ).toBe(true);
  });

  it("remarcar não choca com o próprio horário de onde sai", () => {
    expect(cruzaComAlguma(ana, { inicio: h("09:30"), fim: h("10:30") }, "fisio")).toBe(false);
  });

  it("a frase diz o que já está marcado, com quem e quando", () => {
    expect(
      fraseDoChoque({
        tipo: "Fisioterapia",
        profissional: "Rafael Souza",
        inicio: h("09:00"),
        fim: h("10:00"),
        fuso: "America/Sao_Paulo",
        tag: "pt-BR",
      }),
    ).toBe(
      "Este paciente já tem Fisioterapia com Rafael Souza nesse horário (seg, 12/10, 09:00–10:00). Escolha outro horário.",
    );
  });
});

/** Um banco de mentira que responde por tabela, encadeando os filtros do PostgREST. */
function bancoFalso(tabelas: Record<string, { data: unknown; error?: unknown }>): SupabaseClient {
  const consulta = (resposta: { data: unknown; error?: unknown }) => {
    const r = { data: resposta.data, error: resposta.error ?? null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "lt", "gt", "order", "limit", "in", "neq"]) q[m] = () => q;
    q.maybeSingle = async () => ({
      data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
      error: r.error,
    });
    q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(r).then(ok, falha);
    return q;
  };
  return {
    from: (t: string) => consulta(tabelas[t] ?? { data: [] }),
  } as unknown as SupabaseClient;
}

const ctx = {
  organization_id: "org-1",
  actor: { type: "user", id: "u-1", role: "agent" },
  requestId: "req-1",
} as unknown as HandlerCtx;

describe("pacienteLivreNaClinica — a recusa no servidor", () => {
  const ocupada = {
    id: "ap-fisio",
    starts_at: "2026-10-12T12:00:00Z",
    ends_at: "2026-10-12T13:00:00Z",
    status: "confirmed",
    time_zone: "America/Sao_Paulo",
    owner_user_id: "fisio-1",
    event_type_id: "tipo-fisio",
    title: "Fisioterapia",
  };
  const banco = (extra: Record<string, { data: unknown; error?: unknown }> = {}) =>
    bancoFalso({
      clinica_tipos_atendimento: { data: { modalidade: "medicina" } },
      calendar_appointments: { data: [ocupada] },
      calendar_event_types: { data: { name: "Fisioterapia" } },
      clinica_profissionais: { data: { nome_profissional: "Rafael Souza" } },
      ...extra,
    });
  const pedido = {
    eventTypeId: "tipo-medico",
    contactId: "ana",
    inicio: new Date("2026-10-12T12:00:00Z"),
    fim: new Date("2026-10-12T12:30:00Z"),
  };

  it("recusa com 422 agenda_paciente_ocupado e a frase da sessão que já existe", async () => {
    const erro = await pacienteLivreNaClinica(banco(), ctx, pedido).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect((erro as ApiError).status).toBe(422);
    expect((erro as ApiError).code).toBe("agenda_paciente_ocupado");
    expect((erro as ApiError).message).toContain("Fisioterapia com Rafael Souza");
    expect((erro as ApiError).message).toContain("09:00–10:00");
  });

  it("remarcando a própria sessão, não recusa", async () => {
    await expect(
      pacienteLivreNaClinica(banco(), ctx, { ...pedido, ignorarAgendamentoId: "ap-fisio" }),
    ).resolves.toBeUndefined();
  });

  it("compromisso sem paciente, ou que não é sessão da clínica, não confere", async () => {
    await expect(
      pacienteLivreNaClinica(banco(), ctx, { ...pedido, contactId: null }),
    ).resolves.toBeUndefined();
    await expect(
      pacienteLivreNaClinica(banco({ clinica_tipos_atendimento: { data: null } }), ctx, pedido),
    ).resolves.toBeUndefined();
  });

  it("módulo não instalado é no-op", async () => {
    const semModulo = banco({
      clinica_tipos_atendimento: { data: null, error: { code: "42P01", message: "nao existe" } },
    });
    await expect(pacienteLivreNaClinica(semModulo, ctx, pedido)).resolves.toBeUndefined();
  });
});
