/**
 * AS CONVERSAS DE AGENDA DO CHATBOT — o que acontece dentro das caixas "Marcar horário",
 * "Próximos horários" e "Remarcar ou cancelar".
 *
 * Cada caixa de agenda é uma conversa curta de várias mensagens (escolher o atendimento, o
 * horário, confirmar). Estas funções são regra pura: recebem a etapa em que a conversa parou e o
 * texto do paciente e devolvem as mensagens, a próxima etapa (quando ainda falta resposta) ou a
 * SAÍDA da caixa (quando terminou) — e é o fluxo desenhado que diz para onde cada saída leva
 * (`./motor.ts`). Tudo que toca a agenda entra por `DepsDaAgenda`.
 *
 * ── A regra da multa ───────────────────────────────────────────────────────────────────────
 * O chatbot não decide multa. Antes de cancelar ele PERGUNTA a quem decide
 * (`multaSeCancelarAgora`, que lê a política da clínica) e avisa o paciente; quem grava a multa é
 * o handler da agenda, o mesmo da tela e da IA. Quem quer cancelar em cima da hora sem pagar
 * escolhe falar com a recepção.
 */

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

export type EtapaDaAgenda =
  | { etapa: "escolher_tipo"; tipos: TipoParaMarcar[] }
  | {
      etapa: "escolher_horario";
      tipo: TipoParaMarcar;
      horarios: HorarioOferecido[];
      /** Presente quando a escolha é a NOVA hora de um compromisso que está sendo remarcado. */
      remarcando?: CompromissoDoPaciente;
    }
  | { etapa: "escolher_compromisso"; compromissos: CompromissoDoPaciente[] }
  | { etapa: "acao_compromisso"; compromisso: CompromissoDoPaciente }
  | { etapa: "confirmar_cancelamento"; compromisso: CompromissoDoPaciente; comMulta: boolean };

export type Falha = { ok: false; mensagem: string };

export interface MultaPrevista {
  percentual: number;
  /** A antecedência mínima da política (24 h na TOQ): "faltam menos de N horas". */
  antecedenciaHoras: number;
  valorCents: number | null;
  moeda?: string;
}

export interface DepsDaAgenda {
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

/**
 * O resultado de um passo de agenda:
 *   - `espera`: a caixa ainda espera resposta, nesta etapa;
 *   - `saida`: a caixa terminou por esta saída (`marcou`, `nao_marcou`, `concluiu`...);
 *   - `naoEntendeu`: o texto não é nenhuma das opções — o motor repete `pergunta`;
 *   - `recepcao`: o paciente pediu a recepção dentro da conversa.
 */
export type PassoDaAgenda =
  | { tipo: "espera"; mensagens: string[]; etapa: EtapaDaAgenda }
  | { tipo: "saida"; mensagens: string[]; saida: string }
  | { tipo: "naoEntendeu"; pergunta: string }
  | { tipo: "recepcao"; mensagens: string[] };

/** Um passo que não depende de entender o paciente (começar a caixa, oferecer horários). */
export type PassoResolvido = Exclude<PassoDaAgenda, { tipo: "naoEntendeu" }>;

/** Quantos horários livres o chatbot oferece de uma vez. */
export const HORARIOS_POR_VEZ = 6;

export const VOLTAR = "Digite 0 para voltar ao menu.";
const NENHUM_SERVE = "Nenhum desses horários";
const TOMADO = "Esse horário acabou de ser ocupado.";

// ─── Leitura do que o paciente escreveu ─────────────────────────────────────────────────────

/** Minúsculas, sem acento e com espaços simples. */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * O número escolhido, de 1 a `rotulos.length`, ou `null`. Aceita "2", "2.", "opção 2", "a 2" e o
 * rótulo da opção escrito por extenso ("cancelar"), quando ele bate com uma só opção.
 */
export function numeroEscolhido(texto: string, rotulos: readonly string[]): number | null {
  const n = normalizar(texto);
  const digito = /^(?:opcao|numero|a|o)?\s*(\d{1,2})\s*[.)!-]?\s*$/.exec(n);
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

export function listaNumerada(itens: readonly string[]): string {
  return itens.map((item, i) => `${i + 1} - ${item}`).join("\n");
}

// ─── Próximos horários ──────────────────────────────────────────────────────────────────────

export async function proximosHorarios(
  deps: DepsDaAgenda,
): Promise<{ ok: true; texto: string } | Falha> {
  const r = await deps.proximosCompromissos();
  if (!r.ok) return r;
  return {
    ok: true,
    texto:
      r.compromissos.length === 0
        ? "Você não tem nenhum horário marcado com a gente."
        : `Seus próximos horários:\n\n${r.compromissos.map((c) => `• ${c.rotulo}`).join("\n")}`,
  };
}

// ─── Marcar ─────────────────────────────────────────────────────────────────────────────────

function perguntaDoTipo(tipos: readonly TipoParaMarcar[]): string {
  return `Qual atendimento você quer marcar?\n\n${listaNumerada(tipos.map((t) => t.nome))}\n\n${VOLTAR}`;
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

/** Começa a caixa "Marcar horário". `tipoId` fixo pula a escolha do atendimento. */
export async function comecarMarcacao(
  tipoId: string | null,
  deps: DepsDaAgenda,
): Promise<PassoResolvido> {
  const r = await deps.tiposParaMarcar();
  if (!r.ok) return { tipo: "saida", mensagens: [r.mensagem], saida: "nao_marcou" };
  if (tipoId !== null) {
    const tipo = r.tipos.find((t) => t.id === tipoId);
    if (!tipo) {
      return {
        tipo: "saida",
        mensagens: ["Esse atendimento não está disponível para marcar por aqui."],
        saida: "nao_marcou",
      };
    }
    return oferecerHorarios(tipo, deps);
  }
  if (r.tipos.length === 0) {
    return {
      tipo: "saida",
      mensagens: ["Por aqui ainda não consigo marcar horário."],
      saida: "nao_marcou",
    };
  }
  if (r.tipos.length === 1) return oferecerHorarios(r.tipos[0]!, deps);
  const tipos = r.tipos.slice(0, 9);
  return {
    tipo: "espera",
    mensagens: [perguntaDoTipo(tipos)],
    etapa: { etapa: "escolher_tipo", tipos },
  };
}

async function oferecerHorarios(
  tipo: TipoParaMarcar,
  deps: DepsDaAgenda,
  remarcando?: CompromissoDoPaciente,
  aviso?: string,
): Promise<PassoResolvido> {
  const saidaRuim = remarcando ? "nao_concluiu" : "nao_marcou";
  const r = await deps.horariosLivres(
    tipo,
    remarcando
      ? { ignorarCompromissoId: remarcando.id, donoId: remarcando.donoId ?? null }
      : undefined,
  );
  if (!r.ok) return { tipo: "saida", mensagens: [r.mensagem], saida: saidaRuim };
  if (r.horarios.length === 0) {
    return {
      tipo: "saida",
      mensagens: [`Não encontrei horário livre para ${tipo.nome} nos próximos dias.`],
      saida: saidaRuim,
    };
  }
  const horarios = r.horarios.slice(0, HORARIOS_POR_VEZ);
  const pergunta = perguntaDoHorario(tipo, horarios, remarcando);
  return {
    tipo: "espera",
    mensagens: [aviso ? `${aviso}\n\n${pergunta}` : pergunta],
    etapa: { etapa: "escolher_horario", tipo, horarios, ...(remarcando ? { remarcando } : {}) },
  };
}

// ─── Remarcar ou cancelar ───────────────────────────────────────────────────────────────────

function perguntaDoCompromisso(compromissos: readonly CompromissoDoPaciente[]): string {
  return `Qual horário você quer remarcar ou cancelar?\n\n${listaNumerada(compromissos.map((c) => c.rotulo))}\n\n${VOLTAR}`;
}

function perguntaDaAcao(c: CompromissoDoPaciente): string {
  return `O que você quer fazer com ${c.rotulo}?\n\n1 - Remarcar\n2 - Cancelar\n\n${VOLTAR}`;
}

function perguntaDoCancelamento(
  c: CompromissoDoPaciente,
  multa: MultaPrevista | null,
  deps: Pick<DepsDaAgenda, "formatarDinheiro">,
): string {
  if (multa === null) {
    return `Confirma o cancelamento de ${c.rotulo}?\n\n1 - Sim, cancelar\n2 - Não, manter o horário`;
  }
  const valor =
    multa.valorCents === null ? "" : ` (${deps.formatarDinheiro(multa.valorCents, multa.moeda)})`;
  return (
    `Atenção: faltam menos de ${Math.max(1, Math.ceil(multa.antecedenciaHoras))} horas para ${c.rotulo}. ` +
    `Pela política da clínica, cancelar agora gera multa de ${multa.percentual}% do valor da sessão${valor}.\n\n` +
    "1 - Cancelar mesmo assim\n2 - Não, manter o horário\n3 - Falar com a recepção"
  );
}

/** Começa a caixa "Remarcar ou cancelar". */
export async function comecarRemarcarOuCancelar(deps: DepsDaAgenda): Promise<PassoResolvido> {
  const r = await deps.proximosCompromissos();
  if (!r.ok) return { tipo: "saida", mensagens: [r.mensagem], saida: "nao_concluiu" };
  if (r.compromissos.length === 0) {
    return {
      tipo: "saida",
      mensagens: ["Você não tem nenhum horário marcado com a gente."],
      saida: "concluiu",
    };
  }
  if (r.compromissos.length === 1) {
    const compromisso = r.compromissos[0]!;
    return {
      tipo: "espera",
      mensagens: [perguntaDaAcao(compromisso)],
      etapa: { etapa: "acao_compromisso", compromisso },
    };
  }
  const compromissos = r.compromissos.slice(0, 9);
  return {
    tipo: "espera",
    mensagens: [perguntaDoCompromisso(compromissos)],
    etapa: { etapa: "escolher_compromisso", compromissos },
  };
}

// ─── Uma resposta do paciente dentro de uma caixa de agenda ─────────────────────────────────

/** A pergunta da etapa, para repetir depois de um "não entendi". */
export async function perguntaDaEtapa(etapa: EtapaDaAgenda, deps: DepsDaAgenda): Promise<string> {
  switch (etapa.etapa) {
    case "escolher_tipo":
      return perguntaDoTipo(etapa.tipos);
    case "escolher_horario":
      return perguntaDoHorario(etapa.tipo, etapa.horarios, etapa.remarcando);
    case "escolher_compromisso":
      return perguntaDoCompromisso(etapa.compromissos);
    case "acao_compromisso":
      return perguntaDaAcao(etapa.compromisso);
    case "confirmar_cancelamento": {
      const multa = etapa.comMulta ? await deps.multaSeCancelarAgora(etapa.compromisso) : null;
      return perguntaDoCancelamento(etapa.compromisso, multa, deps);
    }
  }
}

export async function continuarAgenda(
  etapa: EtapaDaAgenda,
  texto: string,
  deps: DepsDaAgenda,
): Promise<PassoDaAgenda> {
  switch (etapa.etapa) {
    case "escolher_tipo": {
      const escolha = numeroEscolhido(
        texto,
        etapa.tipos.map((t) => t.nome),
      );
      if (escolha === null) return { tipo: "naoEntendeu", pergunta: perguntaDoTipo(etapa.tipos) };
      return oferecerHorarios(etapa.tipos[escolha - 1]!, deps);
    }

    case "escolher_horario": {
      const rotulos = [...etapa.horarios.map((h) => h.rotulo), NENHUM_SERVE];
      const escolha = numeroEscolhido(texto, rotulos);
      if (escolha === null) {
        return {
          tipo: "naoEntendeu",
          pergunta: perguntaDoHorario(etapa.tipo, etapa.horarios, etapa.remarcando),
        };
      }
      const saidaRuim = etapa.remarcando ? "nao_concluiu" : "nao_marcou";
      if (escolha === rotulos.length) return { tipo: "saida", mensagens: [], saida: saidaRuim };
      const horario = etapa.horarios[escolha - 1]!;

      if (etapa.remarcando) {
        const r = await deps.remarcar(etapa.remarcando, horario.inicio);
        if (r.ok) {
          return {
            tipo: "saida",
            mensagens: [`Pronto! Seu horário foi remarcado para ${horario.rotulo}.`],
            saida: "concluiu",
          };
        }
        if (r.horarioTomado) return oferecerHorarios(etapa.tipo, deps, etapa.remarcando, TOMADO);
        return { tipo: "saida", mensagens: [r.mensagem], saida: saidaRuim };
      }

      const r = await deps.marcar(etapa.tipo, horario);
      if (r.ok) {
        return {
          tipo: "saida",
          mensagens: [
            r.aguardaConfirmacao
              ? `Separei ${horario.rotulo} para ${etapa.tipo.nome}. A recepção confirma com você em seguida.`
              : `Pronto! Seu horário de ${etapa.tipo.nome} ficou marcado para ${horario.rotulo}.`,
          ],
          saida: "marcou",
        };
      }
      if (r.horarioTomado) return oferecerHorarios(etapa.tipo, deps, undefined, TOMADO);
      return { tipo: "saida", mensagens: [r.mensagem], saida: saidaRuim };
    }

    case "escolher_compromisso": {
      const escolha = numeroEscolhido(
        texto,
        etapa.compromissos.map((c) => c.rotulo),
      );
      if (escolha === null)
        return { tipo: "naoEntendeu", pergunta: perguntaDoCompromisso(etapa.compromissos) };
      const compromisso = etapa.compromissos[escolha - 1]!;
      return {
        tipo: "espera",
        mensagens: [perguntaDaAcao(compromisso)],
        etapa: { etapa: "acao_compromisso", compromisso },
      };
    }

    case "acao_compromisso": {
      const escolha = numeroEscolhido(texto, ["Remarcar", "Cancelar"]);
      if (escolha === null)
        return { tipo: "naoEntendeu", pergunta: perguntaDaAcao(etapa.compromisso) };
      const c = etapa.compromisso;
      if (escolha === 1) {
        if (c.tipoId === null || c.tipoNome === null) {
          return {
            tipo: "saida",
            mensagens: ["Esse horário precisa ser remarcado pela recepção."],
            saida: "nao_concluiu",
          };
        }
        return oferecerHorarios({ id: c.tipoId, nome: c.tipoNome }, deps, c);
      }
      const multa = await deps.multaSeCancelarAgora(c);
      return {
        tipo: "espera",
        mensagens: [perguntaDoCancelamento(c, multa, deps)],
        etapa: { etapa: "confirmar_cancelamento", compromisso: c, comMulta: multa !== null },
      };
    }

    case "confirmar_cancelamento": {
      const rotulos = etapa.comMulta
        ? ["Cancelar mesmo assim", "Manter o horário", "Falar com a recepção"]
        : ["Sim, cancelar", "Manter o horário"];
      const escolha = numeroEscolhido(texto, rotulos);
      if (escolha === null)
        return { tipo: "naoEntendeu", pergunta: await perguntaDaEtapa(etapa, deps) };
      if (escolha === 2) {
        return {
          tipo: "saida",
          mensagens: ["Combinado, seu horário continua marcado."],
          saida: "concluiu",
        };
      }
      if (escolha === 3) return { tipo: "recepcao", mensagens: [] };
      const r = await deps.cancelar(etapa.compromisso);
      if (!r.ok) return { tipo: "saida", mensagens: [r.mensagem], saida: "nao_concluiu" };
      return {
        tipo: "saida",
        mensagens: [`Pronto, cancelei ${etapa.compromisso.rotulo}.`],
        saida: "concluiu",
      };
    }
  }
}
