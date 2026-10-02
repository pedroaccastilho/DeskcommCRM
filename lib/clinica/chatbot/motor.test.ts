import { describe, expect, it, vi } from "vitest";

import { CONFIG_PADRAO, configDoChatbotSchema, configDoMetadata, chatbotLigado, type ConfigDoChatbot } from "./config";
import {
  ERROS_ATE_A_RECEPCAO,
  numeroEscolhido,
  responder,
  textoDoMenu,
  type CompromissoDoPaciente,
  type DepsDoChatbot,
  type EstadoDoChatbot,
  type Etapa,
} from "./motor";

const AGORA = new Date("2026-10-05T12:00:00.000Z");

const CONFIG: ConfigDoChatbot = {
  ...CONFIG_PADRAO,
  ativo: true,
  opcoes: [
    ...CONFIG_PADRAO.opcoes,
    { rotulo: "Endereço", acao: "texto", texto: "Rua das Flores, 100." },
  ],
};

const FISIO = { id: "tipo-fisio", nome: "Fisioterapia" };
const PILATES = { id: "tipo-pilates", nome: "Pilates" };
const SESSAO: CompromissoDoPaciente = {
  id: "comp-1",
  rotulo: "Ter 06/10 às 09:00 · Fisioterapia com Ana",
  tipoId: FISIO.id,
  tipoNome: FISIO.nome,
  donoId: "user-ana",
  revision: 3,
};

function deps(sobre: Partial<DepsDoChatbot> = {}): DepsDoChatbot {
  return {
    agora: () => AGORA,
    tiposParaMarcar: vi.fn(async () => ({ ok: true as const, tipos: [FISIO, PILATES] })),
    horariosLivres: vi.fn(async () => ({
      ok: true as const,
      horarios: [
        { inicio: "2026-10-06T12:00:00.000Z", rotulo: "Ter 06/10 às 09:00" },
        { inicio: "2026-10-07T13:00:00.000Z", rotulo: "Qua 07/10 às 10:00" },
      ],
    })),
    proximosCompromissos: vi.fn(async () => ({ ok: true as const, compromissos: [SESSAO] })),
    marcar: vi.fn(async () => ({ ok: true as const, aguardaConfirmacao: false })),
    remarcar: vi.fn(async () => ({ ok: true as const })),
    cancelar: vi.fn(async () => ({ ok: true as const })),
    multaSeCancelarAgora: vi.fn(async () => null),
    formatarDinheiro: (c) => `R$ ${(c / 100).toFixed(2).replace(".", ",")}`,
    ...sobre,
  };
}

function estado(e: Etapa, quando = AGORA): EstadoDoChatbot {
  return { ...e, atualizado_em: quando.toISOString() };
}

const NO_MENU = estado({ etapa: "menu", erros: 0 });

describe("configuração", () => {
  it("o padrão é válido e nasce desligado", () => {
    expect(configDoChatbotSchema.safeParse(CONFIG_PADRAO).success).toBe(true);
    expect(CONFIG_PADRAO.ativo).toBe(false);
  });

  it("metadata sem a chave, quebrado ou desligado não liga o chatbot", () => {
    expect(chatbotLigado({})).toBe(false);
    expect(chatbotLigado(null)).toBe(false);
    expect(chatbotLigado({ chatbot_menu: { ativo: true } })).toBe(false);
    expect(chatbotLigado({ chatbot_menu: CONFIG_PADRAO })).toBe(false);
    expect(chatbotLigado({ ai_gate: "open", chatbot_menu: CONFIG })).toBe(true);
    expect(configDoMetadata({ chatbot_menu: CONFIG })?.opcoes).toHaveLength(5);
  });

  it("opção de texto fixo sem texto é recusada", () => {
    const r = configDoChatbotSchema.safeParse({
      ...CONFIG,
      opcoes: [{ rotulo: "Endereço", acao: "texto", texto: "" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("numeroEscolhido", () => {
  const rotulos = ["Marcar um horário", "Ver meus próximos horários", "Cancelar"];
  it.each([
    ["1", 1],
    [" 2 ", 2],
    ["3.", 3],
    ["opção 2", 2],
    ["Opção 1", 1],
    ["cancelar", 3],
    ["4", null],
    ["0", null],
    ["oi", null],
    ["horário", null],
  ])("%j → %j", (texto, esperado) => {
    expect(numeroEscolhido(texto, rotulos)).toBe(esperado);
  });
});

describe("o menu", () => {
  it("primeira mensagem: saudação com as opções numeradas", async () => {
    const r = await responder(CONFIG, null, "oi, bom dia", deps());
    expect(r.mensagens).toEqual([textoDoMenu(CONFIG)]);
    expect(r.mensagens[0]).toContain("1 - Marcar um horário");
    expect(r.mensagens[0]).toContain("5 - Endereço");
    expect(r.estado).toMatchObject({ etapa: "menu", erros: 0 });
    expect(r.passarParaRecepcao).toBe(false);
  });

  it("conversa parada além do limite recomeça do menu, sem executar a escolha velha", async () => {
    const antigo = estado(
      { etapa: "escolher_horario", tipo: FISIO, horarios: [{ inicio: "x", rotulo: "y" }], erros: 0 },
      new Date(AGORA.getTime() - 13 * 3_600_000),
    );
    const d = deps();
    const r = await responder(CONFIG, antigo, "1", d);
    expect(r.estado).toMatchObject({ etapa: "menu" });
    expect(d.marcar).not.toHaveBeenCalled();
  });

  it("texto fixo responde e fica no menu", async () => {
    const r = await responder(CONFIG, NO_MENU, "5", deps());
    expect(r.mensagens[0]).toContain("Rua das Flores, 100.");
    expect(r.mensagens[0]).toContain("Digite 0 para voltar ao menu.");
    expect(r.estado).toMatchObject({ etapa: "menu" });
  });

  it("0 em qualquer etapa volta ao menu", async () => {
    const r = await responder(
      CONFIG,
      estado({ etapa: "acao_compromisso", compromisso: SESSAO, erros: 0 }),
      "0",
      deps(),
    );
    expect(r.mensagens).toEqual([textoDoMenu(CONFIG)]);
  });

  it("não entendi repete a pergunta e, na terceira vez, chama a recepção", async () => {
    let atual: EstadoDoChatbot | null = NO_MENU;
    for (let i = 1; i < ERROS_ATE_A_RECEPCAO; i += 1) {
      const r = await responder(CONFIG, atual, "hmm?", deps());
      expect(r.mensagens[0]).toContain(CONFIG.nao_entendi);
      expect(r.mensagens[0]).toContain("1 - Marcar um horário");
      expect(r.passarParaRecepcao).toBe(false);
      atual = r.estado;
    }
    const r = await responder(CONFIG, atual, "hmm?", deps());
    expect(r.mensagens).toEqual([CONFIG.recepcao]);
    expect(r.passarParaRecepcao).toBe(true);
    expect(r.estado).toBeNull();
  });

  it("opção recepção passa a conversa para a equipe", async () => {
    const r = await responder(CONFIG, NO_MENU, "4", deps());
    expect(r).toEqual({ mensagens: [CONFIG.recepcao], estado: null, passarParaRecepcao: true });
  });

  it("pedir atendente em qualquer etapa vai para a recepção", async () => {
    const r = await responder(CONFIG, null, "quero falar com um atendente", deps());
    expect(r.passarParaRecepcao).toBe(true);
  });

  it("sinal de urgência manda procurar o pronto atendimento e chama a equipe", async () => {
    const r = await responder(CONFIG, NO_MENU, "estou com dor muito forte nas costas", deps());
    expect(r.mensagens[0]).toContain("pronto atendimento");
    expect(r.passarParaRecepcao).toBe(true);
  });

  it("'preciso remarcar urgente' não é emergência", async () => {
    const r = await responder(CONFIG, NO_MENU, "preciso remarcar urgente", deps());
    expect(r.mensagens[0]).not.toContain("pronto atendimento");
  });
});

describe("marcar", () => {
  it("tipo, horário e marcação", async () => {
    const d = deps();
    const tipo = await responder(CONFIG, NO_MENU, "1", d);
    expect(tipo.mensagens[0]).toContain("1 - Fisioterapia\n2 - Pilates");
    expect(tipo.estado).toMatchObject({ etapa: "escolher_tipo" });

    const horario = await responder(CONFIG, tipo.estado, "2", d);
    expect(d.horariosLivres).toHaveBeenCalledWith(PILATES, undefined);
    expect(horario.mensagens[0]).toContain("1 - Ter 06/10 às 09:00");
    expect(horario.mensagens[0]).toContain("3 - Nenhum desses, falar com a recepção");

    const fim = await responder(CONFIG, horario.estado, "2", d);
    expect(d.marcar).toHaveBeenCalledWith(PILATES, {
      inicio: "2026-10-07T13:00:00.000Z",
      rotulo: "Qua 07/10 às 10:00",
    });
    expect(fim.mensagens[0]).toBe("Pronto! Seu horário de Pilates ficou marcado para Qua 07/10 às 10:00.");
    expect(fim.estado).toBeNull();
  });

  it("um tipo só pula a pergunta do tipo", async () => {
    const d = deps({ tiposParaMarcar: vi.fn(async () => ({ ok: true as const, tipos: [FISIO] })) });
    const r = await responder(CONFIG, NO_MENU, "1", d);
    expect(r.estado).toMatchObject({ etapa: "escolher_horario", tipo: FISIO });
  });

  it("tipo que precisa de confirmação: diz que separou, não que confirmou", async () => {
    const d = deps({ marcar: vi.fn(async () => ({ ok: true as const, aguardaConfirmacao: true })) });
    const em = estado({
      etapa: "escolher_horario",
      tipo: FISIO,
      horarios: [{ inicio: "2026-10-06T12:00:00.000Z", rotulo: "Ter 06/10 às 09:00" }],
      erros: 0,
    });
    const r = await responder(CONFIG, em, "1", d);
    expect(r.mensagens[0]).toContain("Separei");
    expect(r.mensagens[0]).toContain("A recepção confirma");
  });

  it("horário tomado no meio do caminho: oferece a lista de novo", async () => {
    const d = deps({
      marcar: vi.fn(async () => ({ ok: false as const, mensagem: "x", horarioTomado: true })),
    });
    const em = estado({
      etapa: "escolher_horario",
      tipo: FISIO,
      horarios: [{ inicio: "2026-10-06T12:00:00.000Z", rotulo: "Ter 06/10 às 09:00" }],
      erros: 0,
    });
    const r = await responder(CONFIG, em, "1", d);
    expect(r.mensagens[0]).toContain("Esse horário acabou de ser ocupado.");
    expect(r.estado).toMatchObject({ etapa: "escolher_horario" });
  });

  it("sem horário livre: avisa e chama a recepção", async () => {
    const d = deps({
      tiposParaMarcar: vi.fn(async () => ({ ok: true as const, tipos: [FISIO] })),
      horariosLivres: vi.fn(async () => ({ ok: true as const, horarios: [] })),
    });
    const r = await responder(CONFIG, NO_MENU, "1", d);
    expect(r.mensagens[0]).toContain("Não encontrei horário livre para Fisioterapia");
    expect(r.passarParaRecepcao).toBe(true);
  });

  it("'nenhum desses' chama a recepção sem marcar", async () => {
    const d = deps();
    const em = estado({
      etapa: "escolher_horario",
      tipo: FISIO,
      horarios: [{ inicio: "2026-10-06T12:00:00.000Z", rotulo: "Ter 06/10 às 09:00" }],
      erros: 0,
    });
    const r = await responder(CONFIG, em, "2", d);
    expect(r.passarParaRecepcao).toBe(true);
    expect(d.marcar).not.toHaveBeenCalled();
  });
});

describe("ver, remarcar e cancelar", () => {
  it("próximos horários listados", async () => {
    const r = await responder(CONFIG, NO_MENU, "2", deps());
    expect(r.mensagens[0]).toContain(`• ${SESSAO.rotulo}`);
  });

  it("sem horário marcado: diz isso e volta ao menu", async () => {
    const d = deps({ proximosCompromissos: vi.fn(async () => ({ ok: true as const, compromissos: [] })) });
    const r = await responder(CONFIG, NO_MENU, "3", d);
    expect(r.mensagens[0]).toContain("Você não tem nenhum horário marcado");
    expect(r.estado).toMatchObject({ etapa: "menu" });
  });

  it("remarcar oferece horários sem contar o próprio compromisso e remarca", async () => {
    const d = deps();
    const acao = await responder(CONFIG, NO_MENU, "3", d);
    expect(acao.estado).toMatchObject({ etapa: "acao_compromisso" });
    const horarios = await responder(CONFIG, acao.estado, "1", d);
    expect(d.horariosLivres).toHaveBeenCalledWith(FISIO, { ignorarCompromissoId: SESSAO.id, donoId: "user-ana" });
    const fim = await responder(CONFIG, horarios.estado, "2", d);
    expect(d.remarcar).toHaveBeenCalledWith(SESSAO, "2026-10-07T13:00:00.000Z");
    expect(fim.mensagens[0]).toBe("Pronto! Seu horário foi remarcado para Qua 07/10 às 10:00.");
  });

  it("cancelar com antecedência pede confirmação e cancela", async () => {
    const d = deps();
    const pergunta = await responder(
      CONFIG,
      estado({ etapa: "acao_compromisso", compromisso: SESSAO, erros: 0 }),
      "2",
      d,
    );
    expect(pergunta.mensagens[0]).toContain("Confirma o cancelamento");
    const fim = await responder(CONFIG, pergunta.estado, "1", d);
    expect(d.cancelar).toHaveBeenCalledWith(SESSAO);
    expect(fim.mensagens[0]).toContain("cancelei");
  });

  it("cancelar em cima da hora avisa a multa, e 'manter' não cancela", async () => {
    const d = deps({
      multaSeCancelarAgora: vi.fn(async () => ({ percentual: 30, antecedenciaHoras: 24, valorCents: 4500 })),
    });
    const pergunta = await responder(
      CONFIG,
      estado({ etapa: "acao_compromisso", compromisso: SESSAO, erros: 0 }),
      "cancelar",
      d,
    );
    expect(pergunta.mensagens[0]).toContain("faltam menos de 24 horas");
    expect(pergunta.mensagens[0]).toContain("multa de 30% do valor da sessão (R$ 45,00)");
    expect(pergunta.mensagens[0]).toContain("3 - Falar com a recepção");

    const manter = await responder(CONFIG, pergunta.estado, "2", d);
    expect(d.cancelar).not.toHaveBeenCalled();
    expect(manter.mensagens[0]).toContain("continua marcado");

    const recepcao = await responder(CONFIG, pergunta.estado, "3", d);
    expect(recepcao.passarParaRecepcao).toBe(true);
    expect(d.cancelar).not.toHaveBeenCalled();
  });
});
