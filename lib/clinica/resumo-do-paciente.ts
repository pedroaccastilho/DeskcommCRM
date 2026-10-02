/**
 * O RESUMO NO TOPO DA FICHA DO PACIENTE — o que a recepção pergunta todo dia.
 *
 * Quando é a próxima sessão, se a reavaliação já está marcada, como foram as
 * últimas semanas e quem acompanha o paciente. Tudo sai da agenda do contato
 * (`GET /api/v1/agenda/agendamentos?contact_id=`); nada aqui lê prontuário, que
 * continua visível só para quem tem conselho cadastrado.
 *
 * A reavaliação é reconhecida pelo nome do tipo (ou título), como a modalidade
 * em `cores-da-agenda.ts`: o tipo de atendimento ainda não tem um campo que diga
 * "isto é reavaliação".
 */
import { modalidadeDoTipo } from "./cores-da-agenda";
import { MODALIDADES, type Modalidade } from "./vocabulario";

/** O mínimo de um compromisso do paciente que o resumo lê. */
export type SessaoDoPaciente = {
  id: string;
  titulo: string;
  tipo: string | null;
  /** ISO-8601. */
  inicio: string;
  situacao: string;
  donoId: string | null;
};

export type ResumoDoPaciente = {
  /** A primeira sessão de agora em diante que ainda vale (não cancelada nem perdida). */
  proxima: SessaoDoPaciente | null;
  /** A primeira reavaliação de agora em diante. */
  reavaliacao: SessaoDoPaciente | null;
  /** Sessões passadas que aconteceram (ou não foram marcadas como falta) e as faltas. */
  passadas: { sessoes: number; faltas: number };
  /** Modalidades em que o paciente tem sessão, na ordem do vocabulário. */
  modalidades: Modalidade[];
  /** Quem atende o paciente, da sessão mais próxima de agora para a mais distante. */
  equipe: string[];
};

const QUE_VALEM = new Set(["pending", "confirmed"]);

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function ehReavaliacao(s: Pick<SessaoDoPaciente, "tipo" | "titulo">): boolean {
  return normalizar(s.tipo ?? s.titulo).includes("reavalia");
}

export function resumoDoPaciente(
  sessoes: readonly SessaoDoPaciente[],
  agora: Date,
): ResumoDoPaciente {
  const vivas = sessoes.filter((s) => s.situacao !== "cancelled");
  const ordenadas = [...vivas].sort((a, b) => a.inicio.localeCompare(b.inicio));
  const futuras = ordenadas.filter(
    (s) => new Date(s.inicio).getTime() >= agora.getTime() && QUE_VALEM.has(s.situacao),
  );
  const passadas = ordenadas.filter((s) => new Date(s.inicio).getTime() < agora.getTime());

  const presentes = new Set(vivas.map((s) => modalidadeDoTipo(s.tipo ?? s.titulo)));

  // A equipe começa por quem atende a próxima sessão e segue pela distância até agora.
  const porProximidade = [...vivas].sort(
    (a, b) =>
      Math.abs(new Date(a.inicio).getTime() - agora.getTime()) -
      Math.abs(new Date(b.inicio).getTime() - agora.getTime()),
  );
  const equipe: string[] = [];
  for (const s of porProximidade) {
    if (s.donoId && !equipe.includes(s.donoId)) equipe.push(s.donoId);
  }

  return {
    proxima: futuras[0] ?? null,
    reavaliacao: futuras.find(ehReavaliacao) ?? null,
    passadas: {
      sessoes: passadas.filter((s) => s.situacao !== "no_show").length,
      faltas: passadas.filter((s) => s.situacao === "no_show").length,
    },
    modalidades: MODALIDADES.filter((m) => presentes.has(m)),
    equipe,
  };
}
