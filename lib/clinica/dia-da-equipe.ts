/**
 * O DIA DA EQUIPE — a Agenda de um dia, uma coluna por profissional.
 *
 * É a tela da recepção de manhã: quem atende o quê, em que horário, e o que
 * ainda falta confirmar. A grade do núcleo já sabe desenhar um dia; este
 * arquivo só decide QUAIS colunas ela abre e conta o resumo do topo. Fica no
 * módulo clínica porque a lista de profissionais (`clinica_profissionais`) é
 * dele, e a Agenda só oferece a visão com o módulo instalado.
 */
import type { Agendamento, Pessoa } from "@/components/agenda/tipos";

import { modalidadeDoTipo } from "./cores-da-agenda";
import { MODALIDADES, type Modalidade } from "./vocabulario";

/** O mínimo de `clinica_profissionais` que a visão lê. */
export type ProfissionalDaEquipe = {
  user_id: string;
  modalidades: readonly Modalidade[];
  ativo: boolean;
};

export type ColunaDaEquipe = {
  pessoa: Pessoa;
  /** Vazio para quem não é profissional cadastrado (a recepção com um bloqueio do Google, por exemplo). */
  modalidades: readonly Modalidade[];
};

/**
 * As colunas do dia, na ordem em que aparecem.
 *
 * Os profissionais ATIVOS abrem coluna mesmo sem compromisso, porque "quem está
 * livre hoje" é metade da pergunta da recepção. Quem não é profissional só
 * aparece se tiver algo no dia: some a coluna, sumiria o compromisso. Sem
 * nenhum profissional cadastrado, a equipe inteira vira coluna, como antes de
 * o módulo existir. Com uma pessoa isolada no filtro, só ela.
 */
export function colunasDaEquipe(entrada: {
  pessoas: readonly Pessoa[];
  profissionais: readonly ProfissionalDaEquipe[];
  agendamentosDoDia: readonly Agendamento[];
  isolada: string | null;
}): ColunaDaEquipe[] {
  const { pessoas, profissionais, agendamentosDoDia, isolada } = entrada;
  const ativos = new Map(
    profissionais.filter((p) => p.ativo).map((p) => [p.user_id, p.modalidades] as const),
  );
  const comCompromisso = new Set(agendamentosDoDia.map((a) => a.responsavelId));

  return pessoas
    .filter((p) => {
      if (isolada !== null) return p.id === isolada;
      if (ativos.size === 0) return true;
      return ativos.has(p.id) || comCompromisso.has(p.id);
    })
    .map((pessoa) => ({ pessoa, modalidades: ativos.get(pessoa.id) ?? [] }))
    .sort((a, b) => Number(b.modalidades.length > 0) - Number(a.modalidades.length > 0));
}

export type ResumoDoDia = {
  total: number;
  aguardando: number;
  faltas: number;
  /** Só as modalidades com pelo menos um atendimento, na ordem do vocabulário. */
  porModalidade: Array<{ modalidade: Modalidade | null; quantos: number }>;
};

/**
 * Os números do topo. Ocupação do Google não é atendimento e fica de fora;
 * cancelado já não chega aqui (a grade não o desenha).
 */
export function resumoDoDia(agendamentosDoDia: readonly Agendamento[]): ResumoDoDia {
  const atendimentos = agendamentosDoDia.filter(
    (a) => a.origem !== "google_sync" && a.situacao !== "cancelled",
  );
  const contagem = new Map<Modalidade | null, number>();
  for (const a of atendimentos) {
    const m = modalidadeDoTipo(a.tipo ?? a.titulo);
    contagem.set(m, (contagem.get(m) ?? 0) + 1);
  }
  return {
    total: atendimentos.length,
    aguardando: atendimentos.filter((a) => a.situacao === "pending").length,
    faltas: atendimentos.filter((a) => a.situacao === "no_show").length,
    porModalidade: [...MODALIDADES, null]
      .filter((m) => contagem.has(m))
      .map((m) => ({ modalidade: m, quantos: contagem.get(m)! })),
  };
}
