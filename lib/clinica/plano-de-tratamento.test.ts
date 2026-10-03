/**
 * PLANO DE TRATAMENTO (migration 9006): as regras puras, o texto ao paciente e o aviso que
 * nunca derruba a assinatura — inclusive com a organização parada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrgNaoOperanteError } from "@/lib/organizacao/operante";

const mocks = vi.hoisted(() => ({
  enviar: vi.fn(),
  janela: vi.fn(async () => null as string | null),
}));

vi.mock("@/app/api/v1/messages/_handler", () => ({ sendMessageHandler: mocks.enviar }));
vi.mock("@/lib/automation/start-conversation", () => ({
  ensureConversation: async () => "conversa-1",
}));
vi.mock("@/lib/automation/janela-do-canal", () => ({ adiarAteAJanelaAbrir: mocks.janela }));

import { avisarPacienteDoRetorno, textoDaConfirmacaoDoRetorno } from "./aviso-do-retorno";
import { etapaDoPlano, horarioDoRetorno, sessaoAtual, tipoDoRetorno } from "./plano-de-tratamento";
import { tituloDaTarefa } from "./retorno-agendado";
import { criarRegistroSchema } from "./schemas";
import { camposObrigatoriosFaltando, modeloDoRegistro, valorParaMostrar } from "./vocabulario";

/** PostgREST falso: cada tabela devolve a linha única que o teste pôs. */
function bancoFalso(linhas: Record<string, unknown>) {
  return {
    from: (tabela: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) c[m] = () => c;
      c.maybeSingle = async () => ({ data: linhas[tabela] ?? null, error: null });
      return c;
    },
  } as never;
}

const PACIENTE = {
  id: "contato-1",
  name: "Ana Souza",
  display_name: null,
  phone_number: "+5531999998888",
  is_blocked: false,
};
const AVISO = {
  organizationId: "org-1",
  contactId: "contato-1",
  appointmentId: "compromisso-1",
  profissional: "Dra. Carla",
  quando: new Date("2026-11-20T17:00:00Z"),
  fuso: "America/Sao_Paulo",
};

describe("etapa e sessão atual", () => {
  it("avaliado antes da primeira sessão, em tratamento depois, alta quando assinada", () => {
    expect(etapaDoPlano({ situacao: "ativo" }, 0)).toBe("avaliado");
    expect(etapaDoPlano({ situacao: "ativo" }, 3)).toBe("em_tratamento");
    expect(etapaDoPlano({ situacao: "alta" }, 9)).toBe("alta");
    expect(etapaDoPlano({ situacao: "substituido" }, 2)).toBeNull();
  });

  it("com 5 feitas, a próxima é a sessão 6", () => {
    expect(sessaoAtual(5)).toBe(6);
    expect(sessaoAtual(0)).toBe(1);
  });
});

describe("o tipo do retorno", () => {
  it("prefere reavaliação, depois avaliação, depois qualquer tipo ativo", () => {
    const sessao = { id: "s", nome: "Sessão de fisioterapia", ativo: true };
    const avaliacao = { id: "a", nome: "Avaliação de fisioterapia", ativo: true };
    const reavaliacao = { id: "r", nome: "REAVALIACAO fisio", ativo: true };
    expect(tipoDoRetorno([sessao, avaliacao, reavaliacao])?.id).toBe("r");
    expect(tipoDoRetorno([sessao, avaliacao])?.id).toBe("a");
    expect(tipoDoRetorno([sessao])?.id).toBe("s");
  });

  it("tipo desativado não serve, e sem tipo nenhum a recepção é avisada", () => {
    expect(tipoDoRetorno([{ id: "r", nome: "Reavaliação", ativo: false }])).toBeNull();
    expect(tipoDoRetorno([])).toBeNull();
  });
});

describe("o horário do retorno", () => {
  const diaDe = (i: Date) => i.toISOString().slice(0, 10);
  const slot = (iso: string) => ({ inicio: new Date(iso) });

  it("o primeiro horário livre do dia pedido", () => {
    const r = horarioDoRetorno(
      [slot("2026-11-20T15:00:00Z"), slot("2026-11-20T12:00:00Z"), slot("2026-11-21T12:00:00Z")],
      "2026-11-20",
      diaDe,
    );
    expect(r).toEqual({ inicio: new Date("2026-11-20T12:00:00Z"), noDiaPedido: true });
  });

  it("dia cheio: o mais próximo depois, nunca antes", () => {
    const r = horarioDoRetorno(
      [slot("2026-11-19T12:00:00Z"), slot("2026-11-23T12:00:00Z"), slot("2026-11-24T12:00:00Z")],
      "2026-11-20",
      diaDe,
    );
    expect(r).toEqual({ inicio: new Date("2026-11-23T12:00:00Z"), noDiaPedido: false });
  });

  it("sem vaga nenhuma depois do dia: nada", () => {
    expect(horarioDoRetorno([slot("2026-11-19T12:00:00Z")], "2026-11-20", diaDe)).toBeNull();
  });
});

describe("a tarefa da recepção", () => {
  it("só existe quando falta alguma coisa", () => {
    expect(tituloDaTarefa("marcado", "enviado")).toBeNull();
    expect(tituloDaTarefa("marcado", "nao_deu")).toContain("Avisar");
    expect(tituloDaTarefa("marcado_outro_dia", "enviado")).toContain("outro dia");
    expect(tituloDaTarefa("sem_horario", null)).toContain("Marcar");
    expect(tituloDaTarefa("sem_tipo", null)).toContain("Marcar");
  });
});

describe("a data da reavaliação na avaliação", () => {
  it("toda avaliação tem a data; a anamnese e a evolução não", () => {
    for (const m of ["fisioterapia", "pilates", "medicina", "enfermagem"] as const) {
      expect(modeloDoRegistro(m, "avaliacao").map((c) => c.chave)).toContain("data_reavaliacao");
      expect(modeloDoRegistro(m, "evolucao").map((c) => c.chave)).not.toContain("data_reavaliacao");
    }
    expect(modeloDoRegistro("fisioterapia", "anamnese").map((c) => c.chave)).not.toContain(
      "data_reavaliacao",
    );
  });

  it("data inexistente não assina; data certa assina e aparece como dd/mm/aaaa", () => {
    const base = {
      contact_id: "00000000-0000-4000-8000-000000000001",
      modalidade: "pilates",
      tipo: "avaliacao",
      conteudo: { objetivo: "Postura", data_reavaliacao: "2026-02-31" },
    };
    expect(criarRegistroSchema.safeParse(base).success).toBe(false);
    expect(
      camposObrigatoriosFaltando("pilates", "avaliacao", { data_reavaliacao: "2026-02-31" }),
    ).toEqual(["Data da reavaliação"]);
    const certa = { ...base, conteudo: { objetivo: "Postura", data_reavaliacao: "2026-11-20" } };
    expect(criarRegistroSchema.safeParse(certa).success).toBe(true);
    const campo = modeloDoRegistro("pilates", "avaliacao").find(
      (c) => c.chave === "data_reavaliacao",
    )!;
    expect(valorParaMostrar(campo, "2026-11-20")).toBe("20/11/2026");
  });
});

describe("a confirmação ao paciente", () => {
  beforeEach(() => {
    mocks.enviar.mockReset();
    mocks.janela.mockReset();
    mocks.janela.mockResolvedValue(null);
  });

  it("diz com quem e quando, no fuso da agenda", () => {
    const texto = textoDaConfirmacaoDoRetorno({
      nomeDoPaciente: "Ana",
      profissional: "Dra. Carla",
      quando: AVISO.quando,
      fuso: AVISO.fuso,
    });
    expect(texto).toContain("Oi, Ana!");
    expect(texto).toContain("Dra. Carla");
    expect(texto).toContain("20/11");
    expect(texto).toContain("14:00");
  });

  it("sai pelo WhatsApp quando há contato, canal e janela", async () => {
    mocks.enviar.mockResolvedValue({ status: "sent" });
    const r = await avisarPacienteDoRetorno(
      bancoFalso({
        contacts: PACIENTE,
        channel_sessions: { id: "canal-1" },
        organizations: { locale: "pt-BR" },
      }),
      AVISO,
    );
    expect(r).toEqual({ enviado: true });
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
  });

  it("organização parada: não lança, devolve o motivo", async () => {
    mocks.enviar.mockRejectedValue(new OrgNaoOperanteError("org-1", "suspended"));
    const r = await avisarPacienteDoRetorno(
      bancoFalso({ contacts: PACIENTE, channel_sessions: { id: "canal-1" }, organizations: {} }),
      AVISO,
    );
    expect(r).toEqual({ enviado: false, motivo: "org_parada" });
  });

  it("fora da janela de envio não manda", async () => {
    mocks.janela.mockResolvedValue("2026-11-21T10:00:00.000Z");
    const r = await avisarPacienteDoRetorno(
      bancoFalso({ contacts: PACIENTE, channel_sessions: { id: "canal-1" } }),
      AVISO,
    );
    expect(r).toEqual({ enviado: false, motivo: "fora_da_janela" });
    expect(mocks.enviar).not.toHaveBeenCalled();
  });

  it("mensagem que volta como falha não conta como avisado", async () => {
    mocks.enviar.mockResolvedValue({ status: "failed" });
    const r = await avisarPacienteDoRetorno(
      bancoFalso({ contacts: PACIENTE, channel_sessions: { id: "canal-1" } }),
      AVISO,
    );
    expect(r).toEqual({ enviado: false, motivo: "nao_entregue" });
  });

  it("sem telefone ou sem canal não tenta", async () => {
    expect(
      await avisarPacienteDoRetorno(
        bancoFalso({ contacts: { ...PACIENTE, phone_number: null } }),
        AVISO,
      ),
    ).toEqual({ enviado: false, motivo: "sem_telefone" });
    expect(await avisarPacienteDoRetorno(bancoFalso({ contacts: PACIENTE }), AVISO)).toEqual({
      enviado: false,
      motivo: "sem_canal",
    });
    expect(mocks.enviar).not.toHaveBeenCalled();
  });
});
