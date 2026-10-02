/**
 * O MOTOR DO CHATBOT — anda pelo fluxo desenhado e decide a resposta de UMA mensagem do
 * paciente, sem IA.
 *
 * Função de regra pura sobre (configuração, estado da conversa, texto recebido). Tudo que toca
 * agenda, banco ou WhatsApp entra por `DepsDoChatbot`, e quem liga isso ao mundo real é
 * `./executor.ts`. Por isso o fluxo inteiro é testável com dublês (`motor.test.ts`), e a tela de
 * construção roda o mesmo motor no botão "Testar" com uma agenda de mentira.
 *
 * ── Como anda ──────────────────────────────────────────────────────────────────────────────
 * Do Início, segue as setas executando cada caixa: Mensagem envia e segue; Próximos horários
 * lista e segue; Menu e Pergunta enviam e PARAM esperando a resposta; as caixas de agenda
 * conversam até terminar e saem por "marcou"/"não marcou" ou "resolvido"/"não resolveu";
 * Recepção e Fim encerram. Uma saída sem seta encerra a conversa em silêncio, salvo as saídas de
 * falha das caixas de agenda, que chamam a recepção (ninguém fica sem resposta quando a agenda
 * não deu certo). A próxima mensagem depois do fim recomeça do Início.
 *
 * Em qualquer ponto: "0", "menu" ou "voltar" recomeça do Início; pedido de atendente vai para a
 * recepção; sinal de urgência manda procurar o pronto atendimento e chama a equipe na hora
 * (regras de negócio da TOQ, seção 9). Três respostas seguidas que o chatbot não entende também
 * chamam a recepção: ninguém fica preso num laço de "não entendi".
 */
import {
  comecarMarcacao,
  comecarRemarcarOuCancelar,
  continuarAgenda,
  listaNumerada,
  normalizar,
  numeroEscolhido,
  proximosHorarios,
  VOLTAR,
  type DepsDaAgenda,
  type EtapaDaAgenda,
  type PassoResolvido,
} from "./agenda-conversa";
import {
  destinoDaSaida,
  SAIDA_NAO_CONCLUIU,
  SAIDA_NAO_MARCOU,
  SAIDA_SEGUIR,
  type ConfigDoChatbot,
  type NoDe,
  type NoDoFluxo,
} from "./fluxo";

// ─── O estado da conversa ───────────────────────────────────────────────────────────────────

export type Espera =
  | { tipo: "menu"; noId: string; erros: number }
  | { tipo: "pergunta"; noId: string }
  | { tipo: "agenda"; noId: string; etapa: EtapaDaAgenda; erros: number };

export type EstadoDoChatbot = Espera & { atualizado_em: string };

export interface DepsDoChatbot extends DepsDaAgenda {
  agora(): Date;
  /** Caixa Pergunta com "guardar no nome do contato". */
  guardarNome(nome: string): Promise<void>;
}

export interface RespostaDoChatbot {
  /** Mensagens a enviar, nesta ordem. */
  mensagens: string[];
  /** O estado a gravar na conversa. `null` = recomeça do Início na próxima mensagem. */
  estado: EstadoDoChatbot | null;
  /** Passar a conversa para a equipe depois de enviar as mensagens. */
  passarParaRecepcao: boolean;
}

/** Quantos "não entendi" seguidos antes de chamar a recepção. */
export const ERROS_ATE_A_RECEPCAO = 3;
/** Teto de caixas percorridas numa resposta: um laço de Mensagens sem parada não trava o envio. */
export const MAXIMO_DE_PASSOS = 30;

const URGENCIA =
  "Se for uma emergência, procure agora o pronto atendimento mais próximo ou ligue 192 (SAMU). " +
  "Já estou chamando alguém da nossa equipe.";

const PEDE_MENU = /^(0|menu|voltar|inicio|comecar|recomecar)[.!]?$/;
const PEDE_ATENDENTE =
  /\b(atendente|humano|recepcao|recepcionista|falar com (alguem|uma pessoa))\b/;
/**
 * Os sinais da seção 9 das regras de negócio ("passa para humano na hora"). Não usa o detector
 * genérico do agente (`sinal-de-urgencia.ts`) de propósito: lá "urgente" é sinal, e aqui
 * "preciso remarcar urgente" mandaria o paciente ao pronto atendimento.
 */
const URGENCIA_CLINICA =
  /\b(socorro|emergencia|desmaiou|desmaiei|sangrando|dor (muito )?forte|muita dor|piorou muito|piora subita|caiu|cai no chao|levei um tombo|queda|febre|falta de ar|nao consigo (andar|mexer|respirar))\b/;

/** O texto que a caixa Menu manda: a pergunta, as opções numeradas e a instrução. */
export function textoDoMenu(no: NoDe<"menu">): string {
  return `${no.texto}\n\n${opcoesDoMenu(no)}`;
}

function opcoesDoMenu(no: NoDe<"menu">): string {
  return `${listaNumerada(no.opcoes.map((o) => o.rotulo))}\n\nResponda com o número da opção.`;
}

/** O estado gravado ainda vale? Conversa parada há mais que o limite recomeça do Início. */
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

// ─── O motor ────────────────────────────────────────────────────────────────────────────────

export async function responder(
  config: ConfigDoChatbot,
  estadoGravado: EstadoDoChatbot | null,
  texto: string,
  deps: DepsDoChatbot,
): Promise<RespostaDoChatbot> {
  const estado = estadoVigente(estadoGravado, config, deps.agora());
  const n = normalizar(texto);

  if (URGENCIA_CLINICA.test(n)) return recepcao([URGENCIA]);
  if (PEDE_ATENDENTE.test(n)) return recepcao([config.recepcao]);

  const no = estado ? config.fluxo.nos.find((x) => x.id === estado.noId) : undefined;
  if (estado === null || PEDE_MENU.test(n) || !no || no.tipo !== tipoDaCaixaDaEspera(estado, no)) {
    const inicio = config.fluxo.nos.find((x) => x.tipo === "inicio") ?? null;
    return andar(config, deps, inicio, []);
  }

  switch (estado.tipo) {
    case "menu": {
      const menu = no as NoDe<"menu">;
      const escolha = numeroEscolhido(
        texto,
        menu.opcoes.map((o) => o.rotulo),
      );
      if (escolha === null) return naoEntendi(config, deps, estado, opcoesDoMenu(menu));
      return andar(
        config,
        deps,
        destinoDaSaida(config.fluxo, menu.id, menu.opcoes[escolha - 1]!.id),
        [],
      );
    }
    case "pergunta": {
      const pergunta = no as NoDe<"pergunta">;
      if (pergunta.guardar_em === "nome" && texto.trim().length > 0) {
        await deps.guardarNome(texto.trim().slice(0, 120));
      }
      return andar(config, deps, destinoDaSaida(config.fluxo, pergunta.id, SAIDA_SEGUIR), []);
    }
    case "agenda": {
      const passo = await continuarAgenda(estado.etapa, texto, deps);
      if (passo.tipo === "naoEntendeu") return naoEntendi(config, deps, estado, passo.pergunta);
      return depoisDoPasso(config, deps, no, passo, []);
    }
  }
}

/** A espera combina com a caixa que está no fluxo AGORA? (o fluxo pode ter sido editado) */
function tipoDaCaixaDaEspera(estado: EstadoDoChatbot, no: NoDoFluxo): NoDoFluxo["tipo"] | null {
  if (estado.tipo === "menu") return "menu";
  if (estado.tipo === "pergunta") return "pergunta";
  return no.tipo === "marcar" || no.tipo === "remarcar_cancelar" ? no.tipo : null;
}

function comData(espera: Espera, agora: Date): EstadoDoChatbot {
  return { ...espera, atualizado_em: agora.toISOString() };
}

function recepcao(mensagens: string[]): RespostaDoChatbot {
  return { mensagens, estado: null, passarParaRecepcao: true };
}

function encerra(mensagens: string[]): RespostaDoChatbot {
  return { mensagens, estado: null, passarParaRecepcao: false };
}

/** "Não entendi" + a mesma pergunta de novo, ou a recepção depois do limite de tentativas. */
function naoEntendi(
  config: ConfigDoChatbot,
  deps: DepsDoChatbot,
  estado: EstadoDoChatbot & { tipo: "menu" | "agenda" },
  repetirPergunta: string,
): RespostaDoChatbot {
  const erros = estado.erros + 1;
  if (erros >= ERROS_ATE_A_RECEPCAO) return recepcao([config.recepcao]);
  return {
    mensagens: [`${config.nao_entendi}\n\n${repetirPergunta}`],
    estado: comData({ ...estado, erros }, deps.agora()),
    passarParaRecepcao: false,
  };
}

/** Uma caixa de agenda devolveu um passo: espera mais resposta, chama a recepção ou sai. */
async function depoisDoPasso(
  config: ConfigDoChatbot,
  deps: DepsDoChatbot,
  no: NoDoFluxo,
  passo: PassoResolvido,
  mensagens: string[],
): Promise<RespostaDoChatbot> {
  const juntas = [...mensagens, ...passo.mensagens];
  if (passo.tipo === "recepcao") return recepcao([...juntas, config.recepcao]);
  if (passo.tipo === "espera") {
    return {
      mensagens: juntas,
      estado: comData({ tipo: "agenda", noId: no.id, etapa: passo.etapa, erros: 0 }, deps.agora()),
      passarParaRecepcao: false,
    };
  }
  const destino = destinoDaSaida(config.fluxo, no.id, passo.saida);
  if (
    destino === null &&
    (passo.saida === SAIDA_NAO_MARCOU || passo.saida === SAIDA_NAO_CONCLUIU)
  ) {
    return recepcao([...juntas, config.recepcao]);
  }
  return andar(config, deps, destino, juntas);
}

/** Executa as caixas a partir de `no`, seguindo as setas, até uma que espera ou encerra. */
async function andar(
  config: ConfigDoChatbot,
  deps: DepsDoChatbot,
  primeiro: NoDoFluxo | null,
  mensagens: string[],
): Promise<RespostaDoChatbot> {
  const fluxo = config.fluxo;
  const agora = deps.agora();
  let no = primeiro;
  // Uma caixa visitada duas vezes na MESMA resposta é um laço sem parada (Mensagem → Mensagem):
  // toda volta legítima passa por uma caixa que espera resposta, e ali a resposta termina.
  const vistas = new Set<string>();
  for (let passos = 0; passos < MAXIMO_DE_PASSOS; passos++) {
    if (no === null || vistas.has(no.id)) return encerra(mensagens);
    vistas.add(no.id);
    switch (no.tipo) {
      case "inicio":
        no = destinoDaSaida(fluxo, no.id, SAIDA_SEGUIR);
        continue;
      case "mensagem":
        mensagens.push(no.texto);
        no = destinoDaSaida(fluxo, no.id, SAIDA_SEGUIR);
        continue;
      case "proximos": {
        const r = await proximosHorarios(deps);
        if (!r.ok) return recepcao([...mensagens, r.mensagem, config.recepcao]);
        const seguinte = destinoDaSaida(fluxo, no.id, SAIDA_SEGUIR);
        // Sem nada depois, quem leu a lista precisa saber como voltar.
        mensagens.push(seguinte === null ? `${r.texto}\n\n${VOLTAR}` : r.texto);
        no = seguinte;
        continue;
      }
      case "menu":
        mensagens.push(textoDoMenu(no));
        return {
          mensagens,
          estado: comData({ tipo: "menu", noId: no.id, erros: 0 }, agora),
          passarParaRecepcao: false,
        };
      case "pergunta":
        mensagens.push(no.texto);
        return {
          mensagens,
          estado: comData({ tipo: "pergunta", noId: no.id }, agora),
          passarParaRecepcao: false,
        };
      case "marcar":
        return depoisDoPasso(config, deps, no, await comecarMarcacao(no.tipo_id, deps), mensagens);
      case "remarcar_cancelar":
        return depoisDoPasso(config, deps, no, await comecarRemarcarOuCancelar(deps), mensagens);
      case "recepcao":
        return recepcao([...mensagens, no.texto]);
      case "fim":
        return encerra(no.texto ? [...mensagens, no.texto] : mensagens);
    }
  }
  return encerra(mensagens);
}
