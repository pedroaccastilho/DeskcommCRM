/**
 * "CHEGOU" E "EM ATENDIMENTO" — a rota que marca a etapa do dia de uma sessão (migration 9007).
 *
 * O que só a rota garante (o banco não sabe): a sessão é desta organização, é da clínica (o tipo
 * tem modalidade) e ainda está em aberto; marcar de novo não muda a hora nem quem marcou; e
 * só o que mudou entra na auditoria. A organização vem do papel validado, nunca do corpo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
// Este teste isola o handler; autoridade de suporte é exercitada na suíte própria.
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/impersonate/support")>()),
  requireSupportWrite: vi.fn(async () => null),
}));

const ORG = "22222222-2222-4222-8222-222222222222";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const ANA = "11111111-1111-4111-8111-111111111111";
const BIA = "55555555-5555-4555-8555-555555555555";
const SESSAO = "33333333-3333-4333-8333-333333333333";
const TIPO = "44444444-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;
interface Resposta {
  data: {
    appointment_id: string;
    chegou_em: string | null;
    atendimento_iniciado_em: string | null;
  };
  error: { code: string; message: string };
}
let tabelas: Record<string, Linha[]>;
let erroDaTabela: Record<string, { code: string; message: string } | undefined>;
let upserts: Linha[];

function filtra(tabela: string, filtros: Array<[string, unknown]>): Linha[] {
  return (tabelas[tabela] ?? []).filter((l) => filtros.every(([k, v]) => l[k] === v));
}

function clienteFalso() {
  return {
    from: (tabela: string) => ({
      select: () => {
        const filtros: Array<[string, unknown]> = [];
        const cadeia = {
          eq: (k: string, v: unknown) => {
            filtros.push([k, v]);
            return cadeia;
          },
          maybeSingle: async () => {
            const erro = erroDaTabela[tabela];
            if (erro) return { data: null, error: erro };
            return { data: filtra(tabela, filtros)[0] ?? null, error: null };
          },
        };
        return cadeia;
      },
      upsert: (linha: Linha) => {
        upserts.push(linha);
        const lista = (tabelas[tabela] ??= []);
        const i = lista.findIndex(
          (l) =>
            l.organization_id === linha.organization_id &&
            l.appointment_id === linha.appointment_id,
        );
        if (i >= 0) lista[i] = { ...lista[i], ...linha };
        else lista.push({ ...linha });
        const gravada = lista[i >= 0 ? i : lista.length - 1];
        return { select: () => ({ single: async () => ({ data: gravada, error: null }) }) };
      },
    }),
  };
}

function pedido(corpo: unknown): NextRequest {
  return new NextRequest(`https://crm.exemplo/api/v1/clinica/agenda/${SESSAO}/etapa`, {
    method: "POST",
    body: JSON.stringify(corpo),
  });
}

async function chamar(corpo: unknown, id = SESSAO) {
  const { POST } = await import("@/app/api/v1/clinica/agenda/[id]/etapa/route");
  const r = await POST(pedido(corpo), { params: Promise.resolve({ id }) });
  return { status: r.status, corpo: (await r.json()) as Resposta, r };
}

function quem(userId: string) {
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: userId } as never,
    org: { orgId: ORG, role: "agent" } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  upserts = [];
  erroDaTabela = {};
  tabelas = {
    calendar_appointments: [
      { id: SESSAO, organization_id: ORG, status: "confirmed", event_type_id: TIPO },
    ],
    clinica_tipos_atendimento: [
      { organization_id: ORG, event_type_id: TIPO, modalidade: "fisioterapia" },
    ],
    clinica_sessao_etapas: [],
  };
  quem(ANA);
  vi.mocked(createAdminClient).mockReturnValue(clienteFalso() as never);
});

describe("POST /api/v1/clinica/agenda/[id]/etapa", () => {
  it("'chegou' grava a chegada, devolve o contrato e audita", async () => {
    const { status, corpo, r } = await chamar({ etapa: "chegou" });
    expect(status).toBe(200);
    expect(r.headers.get("X-Request-Id")).toBeTruthy();
    expect(corpo.data.appointment_id).toBe(SESSAO);
    expect(corpo.data.chegou_em).toEqual(expect.any(String));
    expect(corpo.data.atendimento_iniciado_em).toBeNull();
    expect(upserts[0]).toMatchObject({
      organization_id: ORG,
      appointment_id: SESSAO,
      chegou_por_user_id: ANA,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "clinica.sessao_etapa_marcada",
        organizationId: ORG,
        resourceId: SESSAO,
      }),
    );
  });

  it("marcar 'chegou' de novo não muda a hora nem quem marcou, e não audita", async () => {
    await chamar({ etapa: "chegou" });
    const primeira = tabelas.clinica_sessao_etapas![0]!.chegou_em;
    vi.mocked(audit).mockClear();
    quem(BIA);
    const { status, corpo } = await chamar({ etapa: "chegou" });
    expect(status).toBe(200);
    expect(corpo.data.chegou_em).toBe(primeira);
    expect(tabelas.clinica_sessao_etapas![0]!.chegou_por_user_id).toBe(ANA);
    expect(upserts).toHaveLength(1);
    expect(audit).not.toHaveBeenCalled();
  });

  it("'em_atendimento' sem chegada marca as duas", async () => {
    const { corpo } = await chamar({ etapa: "em_atendimento" });
    expect(corpo.data.chegou_em).toEqual(expect.any(String));
    expect(corpo.data.atendimento_iniciado_em).toEqual(expect.any(String));
  });

  it("'em_atendimento' depois de 'chegou' preserva a hora da chegada", async () => {
    tabelas.clinica_sessao_etapas = [
      {
        organization_id: ORG,
        appointment_id: SESSAO,
        chegou_em: "2026-10-03T12:00:00+00:00",
        chegou_por_user_id: BIA,
        atendimento_iniciado_em: null,
        atendimento_iniciado_por_user_id: null,
      },
    ];
    const { corpo } = await chamar({ etapa: "em_atendimento" });
    expect(corpo.data.chegou_em).toBe("2026-10-03T12:00:00+00:00");
    expect(corpo.data.atendimento_iniciado_em).toEqual(expect.any(String));
    expect(upserts[0]).toMatchObject({ chegou_por_user_id: BIA, atendimento_iniciado_por_user_id: ANA });
  });

  it("'desfazer' limpa as duas", async () => {
    await chamar({ etapa: "em_atendimento" });
    const { corpo } = await chamar({ etapa: "desfazer" });
    expect(corpo.data).toEqual({
      appointment_id: SESSAO,
      chegou_em: null,
      atendimento_iniciado_em: null,
    });
  });

  it("'desfazer' sem nada marcado não grava nem audita", async () => {
    const { status } = await chamar({ etapa: "desfazer" });
    expect(status).toBe(200);
    expect(upserts).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });

  it("etapa desconhecida: 422", async () => {
    const { status } = await chamar({ etapa: "realizado" });
    expect(status).toBe(422);
    expect(upserts).toHaveLength(0);
  });

  it("sessão de outra organização: 404 (a organização vem do papel, não do corpo)", async () => {
    tabelas.calendar_appointments = [
      { id: SESSAO, organization_id: OUTRA_ORG, status: "confirmed", event_type_id: TIPO },
    ];
    const { status } = await chamar({ etapa: "chegou", organization_id: OUTRA_ORG });
    expect(status).toBe(404);
    expect(upserts).toHaveLength(0);
  });

  it("sessão que não é da clínica (tipo sem modalidade): 409", async () => {
    tabelas.clinica_tipos_atendimento = [];
    const { status, corpo } = await chamar({ etapa: "chegou" });
    expect(status).toBe(409);
    expect(corpo.error.message).toMatch(/não é da clínica/);
    expect(upserts).toHaveLength(0);
  });

  it.each(["completed", "cancelled", "no_show"])("sessão com status %s: 409", async (s) => {
    tabelas.calendar_appointments![0]!.status = s;
    const { status } = await chamar({ etapa: "chegou" });
    expect(status).toBe(409);
    expect(upserts).toHaveLength(0);
  });

  it("aguardando confirmação também aceita", async () => {
    tabelas.calendar_appointments![0]!.status = "pending";
    const { status } = await chamar({ etapa: "chegou" });
    expect(status).toBe(200);
  });

  it("módulo não instalado: 409 module_not_installed", async () => {
    erroDaTabela.clinica_tipos_atendimento = { code: "42P01", message: "relation does not exist" };
    const { status, corpo } = await chamar({ etapa: "chegou" });
    expect(status).toBe(409);
    expect(corpo.error.code).toBe("module_not_installed");
  });

  it("tabela das etapas ainda ausente: 409 module_not_installed, nunca 500", async () => {
    erroDaTabela.clinica_sessao_etapas = { code: "PGRST205", message: "not in schema cache" };
    const { status, corpo } = await chamar({ etapa: "chegou" });
    expect(status).toBe(409);
    expect(corpo.error.code).toBe("module_not_installed");
  });

  it("sem papel de recepção: a resposta do requireRole volta e nada é gravado", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }) as never,
    });
    const { POST } = await import("@/app/api/v1/clinica/agenda/[id]/etapa/route");
    const r = await POST(pedido({ etapa: "chegou" }), { params: Promise.resolve({ id: SESSAO }) });
    expect(r.status).toBe(403);
    expect(upserts).toHaveLength(0);
    expect(vi.mocked(requireRole).mock.calls[0]?.[0]).toBe("agent");
  });
});
