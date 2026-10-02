/**
 * O MOTOR DO CHATBOT DE MENU — decide a resposta de UMA mensagem do paciente, sem IA.
 *
 * Função de regra pura sobre (configuração, estado da conversa, texto recebido). Tudo que toca
 * agenda, banco ou WhatsApp entra por `DepsDoChatbot`, e quem liga isso ao mundo real é
 * `./executor.ts`. Por isso o fluxo inteiro é testável com dublês (`motor.test.ts`).
 *
 * ── O fluxo ────────────────────────────────────────────────────────────────────────────────
 *   sem estado ─▶ saudação + menu numerado
 *   menu ─▶ opção escolhida:
 *     agendar ─▶ tipo (pulado se só há um) ─▶ horário ─▶ marca
 *     proximo_horario ─▶ lista os próximos horários do paciente
 *     remarcar_cancelar ─▶ compromisso ─▶ remarcar (horário ─▶ remarca) | cancelar (confirma)
 *     recepcao ─▶ texto da recepção + passa a conversa para a equipe
 *     texto ─▶ o texto fixo da opção
 *
 * Em qualquer etapa: "0", "menu" ou "voltar" recomeça do menu; pedido de atendente vai para a
 * recepção; sinal de urgência manda procurar o pronto atendimento e chama a equipe na hora
 * (regras de negócio da TOQ, seção 9). Três respostas seguidas que o chatbot não entende também
 * chamam a recepção: ninguém fica preso num laço de "não entendi".
 *
 * ── A regra da multa ───────────────────────────────────────────────────────────────────────
 * O chatbot não decide multa. Antes de cancelar ele PERGUNTA a quem decide
 * (`multaSeCancelarAgora`, que lê a política da clínica) e avisa o paciente; quem grava a multa é
 * o handler da agenda, o mesmo da tela e da IA. "A IA aplica a regra, não negocia exceção": quem
 * quer cancelar em cima da hora sem pagar escolhe falar com a recepção.
 */
import type { ConfigDoChatbot } from "./config";

// ─── O estado da conversa ───────────────────────────────────────────────────────────────────

export interface TipoParaMarcar {
  id: string;
  nome: string;
}

export interface HorarioOferecido {
  /** Instante ISO, copiado da lista de livres. É o que vai para a marcação. */
  inicio: string;
  /** "Seg 06/10 às 09:00", no fuso da agenda (com o profissional, quando há mais de um). */
  rotulo: string;
  /** Quem atende neste horário, quando o tipo não tem responsável padrão e a lista junta vários. */
  donoId?: string;
}

export interface CompromissoDoPaciente {
  id: string;
  /** "Seg 06/10 às 09:00 · Fisioterapia com Ana" */
  rotulo: string;
  tipoId: string | null;
  tipoNome: string | null;
  /** Quem atende. Remarcar procura horário na agenda DESTA pessoa, não na do responsável do tipo. */
  donoId?: string | null;
  revision?: number;
}

export type Etapa =
  | { etapa: "menu"; erros: number }
  | { etapa: "escolher_tipo"; tipos: TipoParaMarcar[]; erros: number }
  | {
      etapa: "escolher_horario";
      tipo: TipoParaMarcar;
      horarios: HorarioOferecido[];
      /** Presente quando a escolha é a NOVA hora de um compromisso que está sendo remarcado. */
      remarcando?: CompromissoDoPaciente;
      erros: number;
    }
  | { etapa: "escolher_compromisso"; compromissos: CompromissoDoPaciente[]; erros: number }
  | { etapa: "acao_compromisso"; compromisso: CompromissoDoPaciente; erros: number }
  | { etapa: "confirmar_cancelamento"; compromisso: CompromissoDoPaciente; comMulta: boolean; erros: number };

export type EstadoDoChatbot = Etapa & { atualizado_em: string };

// ─── O que o motor pede ao mundo ────────────────────────────────────────────────────────────

export type Falha = { ok: false; mensagem: string };

export interface MultaPrevista {
  percentual: number;
  /** A antecedência mínima da política (24 h na TOQ): "faltam menos de N horas". */
  antecedenciaHoras: number;
  valorCents: number | null;
  moeda?: string;
}

export interface DepsDoChatbot {
  agora(): Date;
  tiposParaMarcar(): Promise<{ ok: true; tipos: TipoParaMarcar[] } | Falha>;
  horariosLivres(
    tipo: TipoParaMarcar,
    remarcando?: { ignorarCompromissoId: string; donoId: string | null },
  ): Promise<{ ok: true; horarios: HorarioOferecido[] } | Falha>;
  proximosCompromissos(): Promise<{ ok: true; compromissos: CompromissoDoPaciente[] } | Falha>;
  marcar(
    tipo: TipoParaMarcar,
    horario: HorarioOferecido,
  ): Promise<{ ok: true; aguardaConfirmacao: boolean } | (Falha & { horarioTomado?: boolean })>;
  remarcar(
    compromisso: CompromissoDoPaciente,
    inicio: string,
  ): Promise<{ ok: true } | (Falha & { horarioTomado?: boolean })>;
  cancelar(compromisso: CompromissoDoPaciente): Promise<{ ok: true } | Falha>;
  multaSeCancelarAgora(compromisso: CompromissoDoPaciente): Promise<MultaPrevista | null>;
  formatarDinheiro(cents: number, moeda?: string): string;
}

export interface RespostaDoChatbot {
  /** Mensagens a enviar, nesta ordem. */
  mensagens: string[];
  /** O estado a gravar na conversa. `null` = recomeça do menu na próxima mensagem. */
  estado: EstadoDoChatbot | null;
  /** Passar a conversa para a equipe depois de enviar as mensagens. */
  passarParaRecepcao: boolean;
}

// ─── Constantes de texto ────────────────────────────────────────────────────────────────────

/** Quantos horários livres o chatbot oferece de uma vez. */
export const HORARIOS_POR_VEZ = 6;
/** Quantos "não entendi" seguidos antes de chamar a recepção. */
export const ERROS_ATE_A_RECEPCAO = 3;

const VOLTAR = "Digite 0 para voltar ao menu.";
const NENHUM_SERVE = "Nenhum desses, falar com a recepção";
const URGENCIA =
  "Se for uma emergência, procure agora o pronto atendimento mais próximo ou ligue 192 (SAMU). " +
  "Já estou chamando alguém da nossa equipe.";

// ─── Leitura do que o paciente escreveu ─────────────────────────────────────────────────────

/** Minúsculas, sem acento e sem pontuação nas pontas. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const PEDE_MENU = /^(0|menu|voltar|inicio|comecar|recomecar)[.!]?$/;
const PEDE_ATENDENTE = /\b(atendente|humano|recepcao|recepcionista|falar com (alguem|uma pessoa))\b/;
/**
 * Os sinais da seção 9 das regras de negócio ("passa para humano na hora"). Não usa o detector
 * genérico do agente (`sinal-de-urgencia.ts`) de propósito: lá "urgente" é sinal, e aqui
 * "preciso remarcar urgente" mandaria o paciente ao pronto atendimento.
 */
const URGENCIA_CLINICA =
  /\b(socorro|emergencia|desmaiou|desmaiei|sangrando|dor (muito )?forte|muita dor|piorou muito|piora subita|caiu|cai no chao|levei um tombo|queda|febre|falta de ar|nao consigo (andar|mexer|respirar))\b/;

/**
 * O número escolhido, de 1 a `quantas`, ou `null`. Aceita "2", "2.", "opção 2", "a 2" e o
 * rótulo da opção escrito por extenso ("cancelar"), quando ele bate com uma só opção.
 */
export function numeroEscolhido(texto: string, rotulos: readonly string[]): number | null {
  const n = normalizar(texto);
  const digito = /^(?:opcao|opção|numero|a|o)?\s*(\d{1,2})\s*[.)!-]?\s*$/.exec(n);
  if (digito) {
    const valor = Number(digito[1]);
    return valor >= 1 && valor <= rotulos.length ? valor : null;
  }
  if (n.length < 3) return null;
  const casam = rotulos
    .map((r, i) => ({ r: normalizar(r), i }))
    .filter(({ r }) => r === n || (n.length >= 5 && r.includes(n)));
  return casam.length === 1 ? casam[0]!.i + 1 : null;
}

function listaNumerada(itens: readonly string[]): string {
  return itens.map((item, i) => `${i + 1} - ${item}`).join("\n");
}

export function textoDoMenu(config: ConfigDoChatbot): string {
  return (
    `${config.saudacao}\n\n${listaNumerada(config.opcoes.map((o) => o.rotulo))}\n\n` +
    "Responda com o número da opção."
  );
}

// ─── O motor ────────────────────────────────────────────────────────────────────────────────

function comData(etapa: Etapa, agora: Date): EstadoDoChatbot {
  return { ...etapa, atualizado_em: agora.toISOString() };
}

/** O estado gravado ainda vale? Conversa parada há mais que o limite recomeça do menu. */
export function estadoVigente(
  estado: EstadoDoChatbot | null,
  config: ConfigDoChatbot,
  agora: Date,
): EstadoDoChatbot | null {
  if (estado === null) return null;
  const quando = Date.parse(estado.atualizado_em);
  if (Number.isNaN(quando)) return null;
  return agora.getTime() - quando > config.reiniciar_apos_horas * 3_600_000 ? null : estado;
}

export async function responder(
  config: ConfigDoChatbot,
  estadoGravado: EstadoDoChatbot | null,
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const estado = estadoVigente(estadoGravado, config, agora);
  const n = normalizar(texto);

  if (URGENCIA_CLINICA.test(n)) {
    return { mensagens: [URGENCIA], estado: null, passarParaRecepcao: true };
  }
  if (PEDE_ATENDENTE.test(n)) {
    return { mensagens: [config.recepcao], estado: null, passarParaRecepcao: true };
  }
  if (estado === null || PEDE_MENU.test(n)) {
    return menu(config, agora);
  }

  switch (estado.etapa) {
    case "menu":
      return escolherNoMenu(config, estado, texto, deps);
    case "escolher_tipo":
      return escolherTipo(config, estado, texto, deps);
    case "escolher_horario":
      return escolherHorario(config, estado, texto, deps);
    case "escolher_compromisso":
      return escolherCompromisso(config, estado, texto, deps);
    case "acao_compromisso":
      return escolherAcaoDoCompromisso(config, estado, texto, deps);
    case "confirmar_cancelamento":
      return confirmarCancelamento(config, estado, texto, deps);
  }
}

function menu(config: ConfigDoChatbot, agora: Date): RespostaDoChatbot {
  return {
    mensagens: [textoDoMenu(config)],
    estado: comData({ etapa: "menu", erros: 0 }, agora),
    passarParaRecepcao: false,
  };
}

/** "Não entendi" + a mesma pergunta de novo, ou a recepção depois do limite de tentativas. */
function naoEntendi(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot,
  repetirPergunta: string,
  agora: Date,
): RespostaDoChatbot {
  const erros = estado.erros + 1;
  if (erros >= ERROS_ATE_A_RECEPCAO) {
    return { mensagens: [config.recepcao], estado: null, passarParaRecepcao: true };
  }
  return {
    mensagens: [`${config.nao_entendi}\n\n${repetirPergunta}`],
    estado: comData({ ...estado, erros } as Etapa, agora),
    passarParaRecepcao: false,
  };
}

/** Falha da agenda: explica e chama a recepção, que resolve à mão. */
function falhaParaRecepcao(config: ConfigDoChatbot, mensagem: string): RespostaDoChatbot {
  return { mensagens: [mensagem, config.recepcao], estado: null, passarParaRecepcao: true };
}

async function escolherNoMenu(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot,
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const escolha = numeroEscolhido(texto, config.opcoes.map((o) => o.rotulo));
  if (escolha === null) return naoEntendi(config, estado, opcoesDoMenu(config), agora);
  const opcao = config.opcoes[escolha - 1]!;

  switch (opcao.acao) {
    case "texto":
      return {
        mensagens: [`${opcao.texto ?? ""}\n\n${VOLTAR}`],
        estado: comData({ etapa: "menu", erros: 0 }, agora),
        passarParaRecepcao: false,
      };
    case "recepcao":
      return { mensagens: [config.recepcao], estado: null, passarParaRecepcao: true };
    case "proximo_horario":
      return proximosHorarios(config, deps);
    case "agendar":
      return comecarMarcacao(config, deps);
    case "remarcar_cancelar":
      return listarParaRemarcarOuCancelar(config, deps);
  }
}

function opcoesDoMenu(config: ConfigDoChatbot): string {
  return `${listaNumerada(config.opcoes.map((o) => o.rotulo))}\n\nResponda com o número da opção.`;
}

async function proximosHorarios(
  config: ConfigDoChatbot,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const r = await deps.proximosCompromissos();
  if (!r.ok) return falhaParaRecepcao(config, r.mensagem);
  const texto =
    r.compromissos.length === 0
      ? "Você não tem nenhum horário marcado com a gente."
      : `Seus próximos horários:\n\n${r.compromissos.map((c) => `• ${c.rotulo}`).join("\n")}`;
  return {
    mensagens: [`${texto}\n\n${VOLTAR}`],
    estado: comData({ etapa: "menu", erros: 0 }, agora),
    passarParaRecepcao: false,
  };
}

// ─── Marcar ─────────────────────────────────────────────────────────────────────────────────

function perguntaDoTipo(tipos: readonly TipoParaMarcar[]): string {
  return `Qual atendimento você quer marcar?\n\n${listaNumerada(tipos.map((t) => t.nome))}\n\n${VOLTAR}`;
}

async function comecarMarcacao(
  config: ConfigDoChatbot,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const r = await deps.tiposParaMarcar();
  if (!r.ok) return falhaParaRecepcao(config, r.mensagem);
  if (r.tipos.length === 0) {
    return falhaParaRecepcao(config, "Por aqui ainda não consigo marcar horário.");
  }
  if (r.tipos.length === 1) return oferecerHorarios(config, r.tipos[0]!, deps);
  const tipos = r.tipos.slice(0, 9);
  return {
    mensagens: [perguntaDoTipo(tipos)],
    estado: comData({ etapa: "escolher_tipo", tipos, erros: 0 }, agora),
    passarParaRecepcao: false,
  };
}

async function escolherTipo(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot & { etapa: "escolher_tipo" },
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const escolha = numeroEscolhido(texto, estado.tipos.map((t) => t.nome));
  if (escolha === null) return naoEntendi(config, estado, perguntaDoTipo(estado.tipos), deps.agora());
  return oferecerHorarios(config, estado.tipos[escolha - 1]!, deps);
}

function perguntaDoHorario(
  tipo: TipoParaMarcar,
  horarios: readonly HorarioOferecido[],
  remarcando?: CompromissoDoPaciente,
): string {
  const abertura = remarcando
    ? `Para quando você quer remarcar ${remarcando.rotulo}?`
    : `Estes são os próximos horários livres para ${tipo.nome}:`;
  const itens = [...horarios.map((h) => h.rotulo), NENHUM_SERVE];
  return `${abertura}\n\n${listaNumerada(itens)}\n\n${VOLTAR}`;
}

async function oferecerHorarios(
  config: ConfigDoChatbot,
  tipo: TipoParaMarcar,
  deps: DepsDoChatbot,
  remarcando?: CompromissoDoPaciente,
  aviso?: string,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const r = await deps.horariosLivres(
    tipo,
    remarcando ? { ignorarCompromissoId: remarcando.id, donoId: remarcando.donoId ?? null } : undefined,
  );
  if (!r.ok) return falhaParaRecepcao(config, r.mensagem);
  if (r.horarios.length === 0) {
    return falhaParaRecepcao(
      config,
      `Não encontrei horário livre para ${tipo.nome} nos próximos dias.`,
    );
  }
  const horarios = r.horarios.slice(0, HORARIOS_POR_VEZ);
  const pergunta = perguntaDoHorario(tipo, horarios, remarcando);
  return {
    mensagens: [aviso ? `${aviso}\n\n${pergunta}` : pergunta],
    estado: comData(
      { etapa: "escolher_horario", tipo, horarios, erros: 0, ...(remarcando ? { remarcando } : {}) },
      agora,
    ),
    passarParaRecepcao: false,
  };
}

async function escolherHorario(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot & { etapa: "escolher_horario" },
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const rotulos = [...estado.horarios.map((h) => h.rotulo), NENHUM_SERVE];
  const escolha = numeroEscolhido(texto, rotulos);
  if (escolha === null) {
    return naoEntendi(
      config,
      estado,
      perguntaDoHorario(estado.tipo, estado.horarios, estado.remarcando),
      deps.agora(),
    );
  }
  if (escolha === rotulos.length) {
    return { mensagens: [config.recepcao], estado: null, passarParaRecepcao: true };
  }
  const horario = estado.horarios[escolha - 1]!;

  if (estado.remarcando) {
    const r = await deps.remarcar(estado.remarcando, horario.inicio);
    if (r.ok) {
      return {
        mensagens: [`Pronto! Seu horário foi remarcado para ${horario.rotulo}.`],
        estado: null,
        passarParaRecepcao: false,
      };
    }
    if (r.horarioTomado) {
      return oferecerHorarios(config, estado.tipo, deps, estado.remarcando, TOMADO);
    }
    return falhaParaRecepcao(config, r.mensagem);
  }

  const r = await deps.marcar(estado.tipo, horario);
  if (r.ok) {
    return {
      mensagens: [
        r.aguardaConfirmacao
          ? `Separei ${horario.rotulo} para ${estado.tipo.nome}. A recepção confirma com você em seguida.`
          : `Pronto! Seu horário de ${estado.tipo.nome} ficou marcado para ${horario.rotulo}.`,
      ],
      estado: null,
      passarParaRecepcao: false,
    };
  }
  if (r.horarioTomado) return oferecerHorarios(config, estado.tipo, deps, undefined, TOMADO);
  return falhaParaRecepcao(config, r.mensagem);
}

const TOMADO = "Esse horário acabou de ser ocupado.";

// ─── Remarcar ou cancelar ───────────────────────────────────────────────────────────────────

function perguntaDoCompromisso(compromissos: readonly CompromissoDoPaciente[]): string {
  return `Qual horário você quer remarcar ou cancelar?\n\n${listaNumerada(compromissos.map((c) => c.rotulo))}\n\n${VOLTAR}`;
}

function perguntaDaAcao(c: CompromissoDoPaciente): string {
  return `O que você quer fazer com ${c.rotulo}?\n\n1 - Remarcar\n2 - Cancelar\n\n${VOLTAR}`;
}

async function listarParaRemarcarOuCancelar(
  config: ConfigDoChatbot,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const r = await deps.proximosCompromissos();
  if (!r.ok) return falhaParaRecepcao(config, r.mensagem);
  if (r.compromissos.length === 0) {
    return {
      mensagens: [`Você não tem nenhum horário marcado com a gente.\n\n${VOLTAR}`],
      estado: comData({ etapa: "menu", erros: 0 }, agora),
      passarParaRecepcao: false,
    };
  }
  if (r.compromissos.length === 1) {
    const compromisso = r.compromissos[0]!;
    return {
      mensagens: [perguntaDaAcao(compromisso)],
      estado: comData({ etapa: "acao_compromisso", compromisso, erros: 0 }, agora),
      passarParaRecepcao: false,
    };
  }
  const compromissos = r.compromissos.slice(0, 9);
  return {
    mensagens: [perguntaDoCompromisso(compromissos)],
    estado: comData({ etapa: "escolher_compromisso", compromissos, erros: 0 }, agora),
    passarParaRecepcao: false,
  };
}

async function escolherCompromisso(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot & { etapa: "escolher_compromisso" },
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const escolha = numeroEscolhido(texto, estado.compromissos.map((c) => c.rotulo));
  if (escolha === null) {
    return naoEntendi(config, estado, perguntaDoCompromisso(estado.compromissos), agora);
  }
  const compromisso = estado.compromissos[escolha - 1]!;
  return {
    mensagens: [perguntaDaAcao(compromisso)],
    estado: comData({ etapa: "acao_compromisso", compromisso, erros: 0 }, agora),
    passarParaRecepcao: false,
  };
}

async function escolherAcaoDoCompromisso(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot & { etapa: "acao_compromisso" },
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const escolha = numeroEscolhido(texto, ["Remarcar", "Cancelar"]);
  if (escolha === null) return naoEntendi(config, estado, perguntaDaAcao(estado.compromisso), agora);
  const c = estado.compromisso;

  if (escolha === 1) {
    if (c.tipoId === null || c.tipoNome === null) {
      return falhaParaRecepcao(config, "Esse horário precisa ser remarcado pela recepção.");
    }
    return oferecerHorarios(config, { id: c.tipoId, nome: c.tipoNome }, deps, c);
  }

  const multa = await deps.multaSeCancelarAgora(c);
  const pergunta = perguntaDoCancelamento(c, multa, deps);
  return {
    mensagens: [pergunta],
    estado: comData(
      { etapa: "confirmar_cancelamento", compromisso: c, comMulta: multa !== null, erros: 0 },
      agora,
    ),
    passarParaRecepcao: false,
  };
}

function perguntaDoCancelamento(
  c: CompromissoDoPaciente,
  multa: MultaPrevista | null,
  deps: Pick<DepsDoChatbot, "formatarDinheiro">,
): string {
  if (multa === null) {
    return `Confirma o cancelamento de ${c.rotulo}?\n\n1 - Sim, cancelar\n2 - Não, manter o horário`;
  }
  const valor = multa.valorCents === null ? "" : ` (${deps.formatarDinheiro(multa.valorCents, multa.moeda)})`;
  return (
    `Atenção: faltam menos de ${Math.max(1, Math.ceil(multa.antecedenciaHoras))} horas para ${c.rotulo}. ` +
    `Pela política da clínica, cancelar agora gera multa de ${multa.percentual}% do valor da sessão${valor}.\n\n` +
    "1 - Cancelar mesmo assim\n2 - Não, manter o horário\n3 - Falar com a recepção"
  );
}

async function confirmarCancelamento(
  config: ConfigDoChatbot,
  estado: EstadoDoChatbot & { etapa: "confirmar_cancelamento" },
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const agora = deps.agora();
  const rotulos = estado.comMulta
    ? ["Cancelar mesmo assim", "Manter o horário", "Falar com a recepção"]
    : ["Sim, cancelar", "Manter o horário"];
  const escolha = numeroEscolhido(texto, rotulos);
  if (escolha === null) {
    const multa = estado.comMulta ? await deps.multaSeCancelarAgora(estado.compromisso) : null;
    return naoEntendi(config, estado, perguntaDoCancelamento(estado.compromisso, multa, deps), agora);
  }
  if (escolha === 2) {
    return { mensagens: ["Combinado, seu horário continua marcado."], estado: null, passarParaRecepcao: false };
  }
  if (escolha === 3) {
    return { mensagens: [config.recepcao], estado: null, passarParaRecepcao: true };
  }
  const r = await deps.cancelar(estado.compromisso);
  if (!r.ok) return falhaParaRecepcao(config, r.mensagem);
  return {
    mensagens: [`Pronto, cancelei ${estado.compromisso.rotulo}.`],
    estado: null,
    passarParaRecepcao: false,
  };
}
