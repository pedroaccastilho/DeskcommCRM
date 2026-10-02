/**
 * O BALCÃO DA RECEPÇÃO — a regra pura por trás de `/app/clinica/balcao` (módulo clínica, fork TOQ).
 *
 * A recepção trabalha o DIA, não a semana: quem chega, quem não confirmou, quem já pode levar
 * falta, quem deve multa. Esta função transforma a grade da clínica (`GET /api/v1/clinica/agenda`)
 * na fila que a tela desenha, e decide UMA ação principal por paciente — a que faz sentido agora.
 * Quem usa a tela não é técnico: um botão em destaque, o resto em "Mais".
 *
 * Nada aqui fala com a rede nem com o relógio do sistema: o `agora` entra por parâmetro, para o
 * teste dizer exatamente em que minuto o botão "Faltou" passa a valer.
 */
import {
  multaDoCancelamento,
  type MultaCalculada,
  type PoliticaDaAgenda,
  type SessaoDaGrade,
} from "./agenda";

/** Em que pé está cada horário do dia, do ponto de vista do balcão. */
export type SituacaoNoBalcao =
  "sem_confirmacao" | "confirmado" | "atrasado" | "realizado" | "faltou" | "cancelado";

/** As ações que o balcão oferece. A ordem da lista que `acoesDoBalcao` devolve é a da tela. */
export type AcaoDoBalcao = "confirmar" | "faltou" | "remarcar" | "whatsapp" | "cancelar" | "ficha";

/** Os filtros do topo do balcão. `hoje` é o dia inteiro. */
export type FiltroDoBalcao = "hoje" | "sem_confirmacao" | "a_caminho" | "atrasado" | "encerrado";

export const FILTROS_DO_BALCAO: readonly FiltroDoBalcao[] = [
  "hoje",
  "sem_confirmacao",
  "a_caminho",
  "atrasado",
  "encerrado",
];

const ABERTOS = new Set(["pending", "confirmed"]);

export function situacaoNoBalcao(sessao: SessaoDaGrade, agora: Date): SituacaoNoBalcao {
  switch (sessao.status) {
    case "completed":
      return "realizado";
    case "no_show":
      return "faltou";
    case "cancelled":
      return "cancelado";
    default:
      break;
  }
  // Passou do horário e ninguém registrou nada: é o caso que a recepção precisa ver primeiro,
  // porque ou o paciente está atrasado ou já pode levar falta.
  if (new Date(sessao.inicio).getTime() <= agora.getTime()) return "atrasado";
  return sessao.status === "pending" ? "sem_confirmacao" : "confirmado";
}

export function passaNoFiltro(situacao: SituacaoNoBalcao, filtro: FiltroDoBalcao): boolean {
  switch (filtro) {
    case "hoje":
      return true;
    case "sem_confirmacao":
      return situacao === "sem_confirmacao";
    case "a_caminho":
      return situacao === "confirmado";
    case "atrasado":
      return situacao === "atrasado";
    case "encerrado":
      return situacao === "realizado" || situacao === "faltou" || situacao === "cancelado";
  }
}

export function contagemPorFiltro(
  sessoes: readonly SessaoDaGrade[],
  agora: Date,
): Record<FiltroDoBalcao, number> {
  const contagem: Record<FiltroDoBalcao, number> = {
    hoje: 0,
    sem_confirmacao: 0,
    a_caminho: 0,
    atrasado: 0,
    encerrado: 0,
  };
  for (const s of sessoes) {
    const situacao = situacaoNoBalcao(s, agora);
    for (const f of FILTROS_DO_BALCAO) if (passaNoFiltro(situacao, f)) contagem[f] += 1;
  }
  return contagem;
}

/** Só sessão da clínica tem tolerância; sem prazo (compromisso comum), a falta vale na hora. */
export function faltaLiberada(sessao: SessaoDaGrade, agora: Date): boolean {
  const desde = sessao.falta_liberada_em ?? sessao.inicio;
  return new Date(desde).getTime() <= agora.getTime();
}

/**
 * O que acontece se o paciente cancelar AGORA. É a mesma conta da rota de cancelamento
 * (`multaDoCancelamento`), feita antes, para a janela avisar o valor antes do clique.
 */
export function previaDaMulta(args: {
  sessao: SessaoDaGrade;
  agora: Date;
  politica: PoliticaDaAgenda;
  precoCents: number | null;
  pelaClinica: boolean;
}): MultaCalculada | null {
  if (!args.sessao.modalidade) return null;
  return multaDoCancelamento({
    inicio: new Date(args.sessao.inicio),
    canceladoEm: args.agora,
    politica: args.politica,
    valorDaSessaoCents: args.precoCents,
    quemCancelou: args.pelaClinica ? "clinica" : "paciente",
  });
}

/**
 * As ações de um horário, a PRINCIPAL primeiro. A tela mostra a primeira em destaque, mais
 * algumas ao lado, e guarda o resto em "Mais".
 *
 * Por que a principal é esta:
 *  - sem confirmação → confirmar é o que tira o horário do limbo;
 *  - atrasado e já fora da tolerância → registrar a falta é o que a regra da clínica pede;
 *  - nos outros casos abertos, a pergunta mais comum no balcão é remarcar.
 * Horário encerrado só abre a ficha e a conversa: não há o que mudar nele.
 */
export function acoesDoBalcao(sessao: SessaoDaGrade, agora: Date): AcaoDoBalcao[] {
  const situacao = situacaoNoBalcao(sessao, agora);
  const temContato = sessao.paciente !== null;
  const temTelefone = Boolean(sessao.paciente?.telefone);
  const acoes: AcaoDoBalcao[] = [];

  if (!ABERTOS.has(sessao.status)) {
    if (temTelefone) acoes.push("whatsapp");
    if (temContato) acoes.push("ficha");
    return acoes;
  }

  if (situacao === "sem_confirmacao") acoes.push("confirmar");
  if (situacao === "atrasado" && faltaLiberada(sessao, agora)) acoes.push("faltou");
  acoes.push("remarcar");
  if (temTelefone) acoes.push("whatsapp");
  acoes.push("cancelar");
  if (situacao === "atrasado" && !faltaLiberada(sessao, agora)) acoes.push("faltou");
  if (situacao === "atrasado" && sessao.status === "pending") acoes.push("confirmar");
  if (temContato) acoes.push("ficha");
  return acoes;
}

/** A fila do dia, na ordem do relógio, com o horário de cada paciente. */
export function filaDoDia(
  sessoes: readonly SessaoDaGrade[],
  agora: Date,
  filtro: FiltroDoBalcao,
): Array<SessaoDaGrade & { situacao: SituacaoNoBalcao }> {
  return sessoes
    .map((s) => ({ ...s, situacao: situacaoNoBalcao(s, agora) }))
    .filter((s) => passaNoFiltro(s.situacao, filtro))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}
