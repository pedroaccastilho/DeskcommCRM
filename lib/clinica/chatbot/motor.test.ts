import { describe, expect, it, vi } from "vitest";

import { numeroEscolhido, type CompromissoDoPaciente } from "./agenda-conversa";
import {
  CONFIG_PADRAO,
  FLUXO_PADRAO,
  chatbotLigado,
  configDoChatbotSchema,
  configDoMetadata,
  problemasDoFluxo,
  saidasDoNo,
  type ConfigDoChatbot,
  type Fluxo,
} from "./fluxo";
import {
  ERROS_ATE_A_RECEPCAO,
  responder,
  type DepsDoChatbot,
  type EstadoDoChatbot,
  type RespostaDoChatbot,
} from "./motor";

const AGORA = new Date("2026-10-05T12:00:00.000Z");
const CONFIG: ConfigDoChatbot = { ...CONFIG_PADRAO, ativo: true };

const FISIO = { id: "11111111-1111-4111-8111-111111111111", nome: "Fisioterapia" };
const PILATES = { id: "22222222-2222-4222-8222-222222222222", nome: "Pilates" };
const SESSAO: CompromissoDoPaciente = {
  id: "comp-1",
  rotulo: "Ter 06/10 às 09:00 · Fisioterapia com Ana",
  tipoId: FISIO.id,
  tipoNome: FISIO.nome,
  donoId: "user-ana",
  revision: 3,
};

const MENU = FLUXO_PADRAO.nos.find((n) => n.tipo === "menu")!;
const FIM = FLUXO_PADRAO.nos.find((n) => n.tipo === "fim")!;
const RECEPCAO = FLUXO_PADRAO.nos.find((n) => n.tipo === "recepcao")!;
const textoDe = (no: { texto?: string }) => no.texto ?? "";

function deps(sobre: Partial<DepsDoChatbot> = {}): DepsDoChatbot {
  return {
    agora: () => AGORA,
    guardarNome: vi.fn(async () => undefined),
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

/** Uma conversa: cada `diz` manda uma mensagem do paciente e guarda o estado para a próxima. */
function conversa(config: ConfigDoChatbot = CONFIG, d: DepsDoChatbot = deps()) {
  let estado: EstadoDoChatbot | null = null;
  return {
    d,
    get estado() {
      return estado;
    },
    async diz(texto: string): Promise<RespostaDoChatbot> {
      const r = await responder(config, estado, texto, d);
      estado = r.estado;
      return r;
    },
  };
}

function comFluxo(fluxo: Fluxo): ConfigDoChatbot {
  return { ...CONFIG, fluxo };
}

describe("o fluxo desenhado", () => {
  it("o padrão é válido, sem problemas, e nasce desligado", () => {
    expect(configDoChatbotSchema.safeParse(CONFIG_PADRAO).success).toBe(true);
    expect(problemasDoFluxo(FLUXO_PADRAO)).toEqual([]);
    expect(CONFIG_PADRAO.ativo).toBe(false);
  });

  it("metadata sem a chave, quebrado ou desligado não liga o chatbot", () => {
    expect(chatbotLigado({})).toBe(false);
    expect(chatbotLigado(null)).toBe(false);
    expect(chatbotLigado({ chatbot_fluxo: { ativo: true } })).toBe(false);
    expect(chatbotLigado({ chatbot_fluxo: CONFIG_PADRAO })).toBe(false);
    expect(chatbotLigado({ ai_gate: "open", chatbot_fluxo: CONFIG })).toBe(true);
    expect(configDoMetadata({ chatbot_fluxo: CONFIG })?.fluxo.nos).toHaveLength(
      FLUXO_PADRAO.nos.length,
    );
  });

  it("um fluxo com problema de desenho não liga, mesmo marcado como ativo", () => {
    const semInicio = {
      ...CONFIG,
      fluxo: { ...FLUXO_PADRAO, nos: FLUXO_PADRAO.nos.filter((n) => n.tipo !== "inicio") },
    };
    expect(configDoChatbotSchema.safeParse(semInicio).success).toBe(true);
    expect(chatbotLigado({ chatbot_fluxo: semInicio })).toBe(false);
  });

  it("acusa começo ausente ou repetido, seta perdida, saída inexistente e saída com duas setas", () => {
    const base = FLUXO_PADRAO;
    const msgs = (f: Fluxo) => problemasDoFluxo(f).map((p) => p.mensagem);

    expect(msgs({ ...base, nos: base.nos.filter((n) => n.tipo !== "inicio") })).toContain(
      "O fluxo precisa de exatamente uma caixa de Início.",
    );
    expect(
      msgs({
        ...base,
        nos: [...base.nos, { id: "inicio2", tipo: "inicio", posicao: { x: 0, y: 0 } }],
      }),
    ).toContain("O fluxo precisa de exatamente uma caixa de Início.");
    expect(
      msgs({
        ...base,
        setas: [...base.setas, { id: "x", origem: "menu", saida: "op1", destino: "nada" }],
      }),
    ).toContain("Uma seta aponta para uma caixa que não existe.");
    expect(
      msgs({
        ...base,
        setas: [...base.setas, { id: "x", origem: "menu", saida: "op9", destino: "fim" }],
      }),
    ).toContain("Uma seta sai de uma opção que não existe mais.");
    expect(
      msgs({
        ...base,
        setas: [...base.setas, { id: "x", origem: "menu", saida: "op1", destino: "fim" }],
      }),
    ).toContain("Uma saída tem mais de uma seta. Deixe só uma.");
    expect(msgs({ ...base, setas: base.setas.filter((s) => s.origem !== "inicio") })).toContain(
      "Ligue o Início à primeira caixa da conversa.",
    );
  });

  it("cada opção do menu é uma saída, com o número que o paciente lê", () => {
    expect(saidasDoNo(MENU).map((s) => s.rotulo)).toEqual([
      "1 - Marcar um horário",
      "2 - Ver meus próximos horários",
      "3 - Remarcar ou cancelar",
      "4 - Falar com a recepção",
    ]);
    expect(saidasDoNo(RECEPCAO)).toEqual([]);
  });
});

describe("numeroEscolhido", () => {
  const rotulos = ["Marcar um horário", "Ver meus próximos horários", "Cancelar"];
  it.each([
    ["2", 2],
    ["2.", 2],
    [" opção 3 ", 3],
    ["a 1", 1],
    ["cancelar", 3],
    ["4", null],
    ["0", null],
    ["oi", null],
    ["horário", null],
  ])("%j → %j", (texto, esperado) => {
    expect(numeroEscolhido(texto, rotulos)).toBe(esperado);
  });
});

describe("andando pelo fluxo padrão", () => {
  it("a primeira mensagem recebe o menu e a conversa espera a opção", async () => {
    const c = conversa();
    const r = await c.diz("oi");
    expect(r.mensagens).toHaveLength(1);
    expect(r.mensagens[0]).toContain(textoDe(MENU));
    expect(r.mensagens[0]).toContain("1 - Marcar um horário");
    expect(r.passarParaRecepcao).toBe(false);
    expect(c.estado).toMatchObject({ tipo: "menu", noId: "menu", erros: 0 });
  });

  it("marcar: atendimento, horário, marca e segue a seta 'Marcou' até o Fim", async () => {
    const c = conversa();
    await c.diz("oi");
    expect((await c.diz("1")).mensagens[0]).toContain("Qual atendimento");
    expect((await c.diz("1")).mensagens[0]).toContain("1 - Ter 06/10 às 09:00");
    const r = await c.diz("2");
    expect(c.d.marcar).toHaveBeenCalledWith(FISIO, {
      inicio: "2026-10-07T13:00:00.000Z",
      rotulo: "Qua 07/10 às 10:00",
    });
    expect(r.mensagens).toEqual([
      "Pronto! Seu horário de Fisioterapia ficou marcado para Qua 07/10 às 10:00.",
      textoDe(FIM),
    ]);
    expect(r.estado).toBeNull();
    expect(r.passarParaRecepcao).toBe(false);
  });

  it("'Nenhum desses horários' segue a seta 'Não marcou' até a recepção", async () => {
    const c = conversa();
    await c.diz("oi");
    await c.diz("1");
    await c.diz("2");
    const r = await c.diz("3");
    expect(r.mensagens).toEqual([textoDe(RECEPCAO)]);
    expect(r.passarParaRecepcao).toBe(true);
    expect(c.d.marcar).not.toHaveBeenCalled();
  });

  it("horário tomado entre a lista e a escolha: avisa e oferece a lista nova", async () => {
    const d = deps({
      marcar: vi.fn(async () => ({ ok: false as const, mensagem: "x", horarioTomado: true })),
    });
    const c = conversa(CONFIG, d);
    await c.diz("oi");
    await c.diz("1");
    await c.diz("1");
    const r = await c.diz("1");
    expect(r.mensagens[0]).toContain("acabou de ser ocupado");
    expect(c.estado).toMatchObject({ tipo: "agenda", etapa: { etapa: "escolher_horario" } });
  });

  it("próximos horários lista e segue para o Fim", async () => {
    const c = conversa();
    await c.diz("oi");
    const r = await c.diz("2");
    expect(r.mensagens[0]).toContain(SESSAO.rotulo);
    expect(r.mensagens[1]).toBe(textoDe(FIM));
    expect(r.estado).toBeNull();
  });

  it("remarcar: procura horário na agenda de quem atende e remarca", async () => {
    const c = conversa();
    await c.diz("oi");
    expect((await c.diz("3")).mensagens[0]).toContain("1 - Remarcar");
    expect((await c.diz("1")).mensagens[0]).toContain("Para quando você quer remarcar");
    expect(c.d.horariosLivres).toHaveBeenCalledWith(
      { id: FISIO.id, nome: FISIO.nome },
      { ignorarCompromissoId: "comp-1", donoId: "user-ana" },
    );
    const r = await c.diz("1");
    expect(c.d.remarcar).toHaveBeenCalledWith(SESSAO, "2026-10-06T12:00:00.000Z");
    expect(r.mensagens).toEqual([
      "Pronto! Seu horário foi remarcado para Ter 06/10 às 09:00.",
      textoDe(FIM),
    ]);
  });

  it("cancelar em cima da hora avisa a multa antes, e só então cancela", async () => {
    const d = deps({
      multaSeCancelarAgora: vi.fn(async () => ({
        percentual: 30,
        antecedenciaHoras: 24,
        valorCents: 4500,
      })),
    });
    const c = conversa(CONFIG, d);
    await c.diz("oi");
    await c.diz("3");
    const aviso = await c.diz("2");
    expect(aviso.mensagens[0]).toContain("multa de 30%");
    expect(aviso.mensagens[0]).toContain("R$ 45,00");
    expect(d.cancelar).not.toHaveBeenCalled();
    const r = await c.diz("1");
    expect(d.cancelar).toHaveBeenCalledWith(SESSAO);
    expect(r.mensagens[0]).toContain("cancelei");
  });

  it("no aviso de multa, 'Falar com a recepção' passa a conversa sem cancelar", async () => {
    const d = deps({
      multaSeCancelarAgora: vi.fn(async () => ({
        percentual: 30,
        antecedenciaHoras: 24,
        valorCents: null,
      })),
    });
    const c = conversa(CONFIG, d);
    await c.diz("oi");
    await c.diz("3");
    await c.diz("2");
    const r = await c.diz("3");
    expect(r.passarParaRecepcao).toBe(true);
    expect(r.mensagens).toEqual([CONFIG.recepcao]);
    expect(d.cancelar).not.toHaveBeenCalled();
  });

  it(`${ERROS_ATE_A_RECEPCAO} respostas sem entender chamam a recepção`, async () => {
    const c = conversa();
    await c.diz("oi");
    const primeira = await c.diz("banana");
    expect(primeira.mensagens[0]).toContain(CONFIG.nao_entendi);
    expect(primeira.mensagens[0]).toContain("1 - Marcar um horário");
    await c.diz("banana");
    const terceira = await c.diz("banana");
    expect(terceira.passarParaRecepcao).toBe(true);
    expect(terceira.mensagens).toEqual([CONFIG.recepcao]);
  });

  it("sinal de urgência manda ao pronto atendimento e chama a equipe; 'remarcar urgente' não", async () => {
    const r = await conversa().diz("estou com muita dor, piorou muito");
    expect(r.mensagens[0]).toContain("192");
    expect(r.passarParaRecepcao).toBe(true);

    const c = conversa();
    await c.diz("oi");
    const comum = await c.diz("preciso remarcar urgente");
    expect(comum.passarParaRecepcao).toBe(false);
  });

  it("pedir atendente em qualquer ponto vai para a recepção", async () => {
    const c = conversa();
    await c.diz("oi");
    await c.diz("1");
    const r = await c.diz("quero falar com um atendente");
    expect(r.passarParaRecepcao).toBe(true);
    expect(r.mensagens).toEqual([CONFIG.recepcao]);
  });

  it("'0' no meio da marcação volta ao começo", async () => {
    const c = conversa();
    await c.diz("oi");
    await c.diz("1");
    const r = await c.diz("0");
    expect(r.mensagens[0]).toContain(textoDe(MENU));
    expect(c.estado).toMatchObject({ tipo: "menu" });
  });

  it("conversa parada além do limite recomeça do começo", async () => {
    const velho: EstadoDoChatbot = {
      tipo: "agenda",
      noId: "marcar",
      etapa: { etapa: "escolher_tipo", tipos: [FISIO, PILATES] },
      erros: 0,
      atualizado_em: new Date(AGORA.getTime() - 13 * 3_600_000).toISOString(),
    };
    const r = await responder(CONFIG, velho, "1", deps());
    expect(r.mensagens[0]).toContain(textoDe(MENU));
  });

  it("estado que aponta para uma caixa apagada do fluxo recomeça do começo", async () => {
    const perdido: EstadoDoChatbot = {
      tipo: "menu",
      noId: "nao-existe",
      erros: 0,
      atualizado_em: AGORA.toISOString(),
    };
    const r = await responder(CONFIG, perdido, "1", deps());
    expect(r.mensagens[0]).toContain(textoDe(MENU));
  });
});

describe("fluxos que a clínica desenha", () => {
  const p = { x: 0, y: 0 };

  it("Mensagem segue sozinha; Pergunta espera e guarda o nome; o Fim encerra", async () => {
    const config = comFluxo({
      nos: [
        { id: "i", tipo: "inicio", posicao: p },
        { id: "m1", tipo: "mensagem", posicao: p, texto: "Bem-vindo à TOQ!" },
        { id: "q", tipo: "pergunta", posicao: p, texto: "Qual é o seu nome?", guardar_em: "nome" },
        { id: "m2", tipo: "mensagem", posicao: p, texto: "Prazer!" },
        { id: "f", tipo: "fim", posicao: p, texto: "" },
      ],
      setas: [
        { id: "a", origem: "i", saida: "seguir", destino: "m1" },
        { id: "b", origem: "m1", saida: "seguir", destino: "q" },
        { id: "c", origem: "q", saida: "seguir", destino: "m2" },
        { id: "d", origem: "m2", saida: "seguir", destino: "f" },
      ],
    });
    const c = conversa(config);
    expect((await c.diz("oi")).mensagens).toEqual(["Bem-vindo à TOQ!", "Qual é o seu nome?"]);
    expect(c.estado).toMatchObject({ tipo: "pergunta", noId: "q" });
    const r = await c.diz("  Maria Silva ");
    expect(c.d.guardarNome).toHaveBeenCalledWith("Maria Silva");
    expect(r.mensagens).toEqual(["Prazer!"]);
    expect(r.estado).toBeNull();
  });

  it("Marcar com atendimento fixo pula a escolha do atendimento", async () => {
    const config = comFluxo({
      nos: [
        { id: "i", tipo: "inicio", posicao: p },
        { id: "mk", tipo: "marcar", posicao: p, tipo_id: PILATES.id },
      ],
      setas: [{ id: "a", origem: "i", saida: "seguir", destino: "mk" }],
    });
    const c = conversa(config);
    const r = await c.diz("oi");
    expect(r.mensagens[0]).toContain("horários livres para Pilates");
    expect(c.d.horariosLivres).toHaveBeenCalledWith(PILATES, undefined);
  });

  it("'Não marcou' sem seta chama a recepção; 'Marcou' sem seta só encerra", async () => {
    const config = comFluxo({
      nos: [
        { id: "i", tipo: "inicio", posicao: p },
        { id: "mk", tipo: "marcar", posicao: p, tipo_id: FISIO.id },
      ],
      setas: [{ id: "a", origem: "i", saida: "seguir", destino: "mk" }],
    });
    const semHorario = deps({
      horariosLivres: vi.fn(async () => ({ ok: true as const, horarios: [] })),
    });
    const r = await conversa(config, semHorario).diz("oi");
    expect(r.passarParaRecepcao).toBe(true);
    expect(r.mensagens).toEqual([
      "Não encontrei horário livre para Fisioterapia nos próximos dias.",
      CONFIG.recepcao,
    ]);

    const c = conversa(config);
    await c.diz("oi");
    const marcou = await c.diz("1");
    expect(marcou.passarParaRecepcao).toBe(false);
    expect(marcou.estado).toBeNull();
  });

  it("opção do menu sem seta encerra sem responder nada", async () => {
    const fluxo: Fluxo = {
      ...FLUXO_PADRAO,
      setas: FLUXO_PADRAO.setas.filter((s) => s.saida !== "op2"),
    };
    const c = conversa(comFluxo(fluxo));
    await c.diz("oi");
    const r = await c.diz("2");
    expect(r.mensagens).toEqual([]);
    expect(r.estado).toBeNull();
  });

  it("laço de Mensagens sem parada manda cada uma uma vez só", async () => {
    const config = comFluxo({
      nos: [
        { id: "i", tipo: "inicio", posicao: p },
        { id: "m1", tipo: "mensagem", posicao: p, texto: "um" },
        { id: "m2", tipo: "mensagem", posicao: p, texto: "dois" },
      ],
      setas: [
        { id: "a", origem: "i", saida: "seguir", destino: "m1" },
        { id: "b", origem: "m1", saida: "seguir", destino: "m2" },
        { id: "c", origem: "m2", saida: "seguir", destino: "m1" },
      ],
    });
    const r = await conversa(config).diz("oi");
    expect(r.mensagens).toEqual(["um", "dois"]);
    expect(r.estado).toBeNull();
  });

  it("voltar do fim de uma opção ao menu é uma seta para o mesmo Menu", async () => {
    const fluxo: Fluxo = {
      ...FLUXO_PADRAO,
      setas: FLUXO_PADRAO.setas.map((s) =>
        s.origem === "proximos" ? { ...s, destino: "menu" } : s,
      ),
    };
    const c = conversa(comFluxo(fluxo));
    await c.diz("oi");
    const r = await c.diz("2");
    expect(r.mensagens[0]).toContain(SESSAO.rotulo);
    expect(r.mensagens[1]).toContain(textoDe(MENU));
    expect(c.estado).toMatchObject({ tipo: "menu", noId: "menu" });
  });
});
