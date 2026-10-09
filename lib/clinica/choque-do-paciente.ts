/**
 * O PACIENTE NÃO ESTÁ EM DOIS LUGARES AO MESMO TEMPO (módulo clínica).
 *
 * A agenda de cada profissional é dele: o médico pode atender outro paciente às 09h00 enquanto a
 * Ana está na fisioterapia às 09h00. O que não pode é a ANA ter duas sessões que se cruzam, com
 * quem for. O núcleo já recusa o choque na agenda de quem atende (`exigeSemSobreposicao`); este
 * arquivo é a metade do paciente.
 *
 * Contas puras aqui; a leitura no banco está em `lib/clinica/regras-da-agenda.ts`
 * (`pacienteLivreNaClinica`), e o chatbot usa `cruzaComAlguma` para não oferecer o horário.
 *
 * - Cruzar é SOBREPOR, não só começar na mesma hora: 09:00–10:00 cruza 09:30–10:30. Encostar
 *   (uma termina às 10:00, a outra começa às 10:00) não cruza.
 * - Sessão desmarcada ou falta libera o horário (`SITUACOES_QUE_LIBERAM`, o mesmo vocabulário da
 *   ocupação do profissional). Remarcar é a mesma linha mudando de horário, então o horário de
 *   onde ela sai não conta (`ignorarId`).
 */
import { SITUACOES_QUE_LIBERAM } from "@/lib/agenda/ocupados";

export interface SessaoDoPaciente {
  id: string;
  inicio: Date;
  fim: Date;
  status: string;
}

const LIBERAM = new Set<string>(SITUACOES_QUE_LIBERAM);

/** A primeira sessão viva do paciente que cruza o pedido, ou `null`. */
export function sessaoQueChoca<S extends SessaoDoPaciente>(
  sessoes: S[],
  pedido: { inicio: Date; fim: Date; ignorarId?: string | null },
): S | null {
  const ini = pedido.inicio.getTime();
  const fim = pedido.fim.getTime();
  const vivas = sessoes
    .filter((s) => s.id !== pedido.ignorarId && !LIBERAM.has(s.status))
    .filter((s) => s.inicio.getTime() < fim && s.fim.getTime() > ini)
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return vivas[0] ?? null;
}

/** O horário oferecido cruza alguma sessão viva do paciente? */
export function cruzaComAlguma(
  sessoes: SessaoDoPaciente[],
  horario: { inicio: Date; fim: Date },
  ignorarId?: string | null,
): boolean {
  return sessaoQueChoca(sessoes, { ...horario, ignorarId }) !== null;
}

/** A frase da recusa, com o que já está marcado, para a recepção resolver sem abrir outra tela. */
export function fraseDoChoque(args: {
  tipo: string | null;
  profissional: string | null;
  inicio: Date;
  fim: Date;
  fuso: string;
  /** A tag do idioma de quem lê (`tagDeIdioma`), para o dia e a hora. */
  tag: string;
}): string {
  const dia = new Intl.DateTimeFormat(args.tag, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: args.fuso,
  })
    .format(args.inicio)
    .replace(".", "");
  const hora = (d: Date) =>
    new Intl.DateTimeFormat(args.tag, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: args.fuso,
    }).format(d);
  const oQue = args.tipo ?? "uma sessão";
  const comQuem = args.profissional ? ` com ${args.profissional}` : "";
  return (
    `Este paciente já tem ${oQue}${comQuem} nesse horário (${dia}, ${hora(args.inicio)}–${hora(args.fim)}). ` +
    "Escolha outro horário."
  );
}
