"use client";
/**
 * As caixas do construtor do chatbot: o cartão que o canvas desenha e o que cada tipo de caixa
 * é para quem monta (nome na paleta, ícone, cor, explicação e como nasce).
 *
 * O cartão segue o desenho dos cartões do editor de fluxos dos Follow-ups
 * (`app/app/ai/followups/[id]/_components/nodes/NodeCard.tsx`): ícone + título + resumo, borda
 * colorida à esquerda e UMA bolinha por saída, ao lado do nome da saída — é o que deixa ver de
 * qual opção do menu sai cada seta. Não importa aquele componente porque ele fala o vocabulário
 * do grafo dos Follow-ups (ramos, condições, etapas do funil), que o chatbot não tem.
 */
import type { ComponentType } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

import { useT } from "@/hooks/i18n/useT";
import {
  SAIDA_SEGUIR,
  saidasDoNo,
  type NoDoFluxo,
  type TipoDeNo,
} from "@/lib/clinica/chatbot/fluxo";
import {
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  ChatCircle,
  Flag,
  List,
  Play,
  Question,
  UsersThree,
  Warning,
} from "@/lib/ui/icons";
import { cn } from "@/lib/utils";

type Icone = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

export interface VisualDaCaixa {
  nome: string;
  ajuda: string;
  icone: Icone;
  chip: string;
  borda: string;
}

export const VISUAL: Record<TipoDeNo, VisualDaCaixa> = {
  inicio: {
    nome: "Início",
    ajuda: "Onde a conversa começa, quando o paciente manda a primeira mensagem.",
    icone: Play,
    chip: "bg-accent-soft text-accent",
    borda: "border-l-accent-500",
  },
  mensagem: {
    nome: "Mensagem",
    ajuda: "Envia um texto e segue para a próxima caixa.",
    icone: ChatCircle,
    chip: "bg-success-bg text-success-fg",
    borda: "border-l-success",
  },
  menu: {
    nome: "Menu de opções",
    ajuda: "Pergunta e mostra opções numeradas. Cada opção tem a sua seta.",
    icone: List,
    chip: "bg-warning-bg text-warning-fg",
    borda: "border-l-warning",
  },
  pergunta: {
    nome: "Pergunta",
    ajuda: "Faz uma pergunta e espera a resposta, que pode virar o nome do contato.",
    icone: Question,
    chip: "bg-info-bg text-info-fg",
    borda: "border-l-info",
  },
  marcar: {
    nome: "Marcar horário",
    ajuda: "Mostra os próximos horários livres e marca o escolhido.",
    icone: CalendarPlus,
    chip: "bg-accent-soft text-accent",
    borda: "border-l-accent-500",
  },
  proximos: {
    nome: "Próximos horários",
    ajuda: "Lista os horários que o paciente já tem marcados.",
    icone: CalendarCheck,
    chip: "bg-accent-soft text-accent",
    borda: "border-l-accent-500",
  },
  remarcar_cancelar: {
    nome: "Remarcar ou cancelar",
    ajuda:
      "Deixa remarcar ou cancelar um horário. Avisa a multa antes de cancelar em cima da hora.",
    icone: CalendarX,
    chip: "bg-accent-soft text-accent",
    borda: "border-l-accent-500",
  },
  recepcao: {
    nome: "Passar para a recepção",
    ajuda: "Manda um aviso e passa a conversa para a equipe. O chatbot para de responder.",
    icone: UsersThree,
    chip: "bg-error-bg text-error-fg",
    borda: "border-l-error",
  },
  fim: {
    nome: "Fim",
    ajuda: "Encerra a conversa. A próxima mensagem do paciente começa de novo do Início.",
    icone: Flag,
    chip: "bg-surface text-text-muted",
    borda: "border-l-border",
  },
};

/** As caixas que a paleta oferece (o Início é único e já vem no fluxo). */
export const TIPOS_DA_PALETA: TipoDeNo[] = [
  "mensagem",
  "menu",
  "pergunta",
  "marcar",
  "proximos",
  "remarcar_cancelar",
  "recepcao",
  "fim",
];

/** Uma caixa nova, com textos de exemplo que a pessoa troca. */
export function caixaNova(
  tipo: TipoDeNo,
  id: string,
  posicao: { x: number; y: number },
): NoDoFluxo {
  switch (tipo) {
    case "inicio":
      return { id, tipo, posicao };
    case "mensagem":
      return { id, tipo, posicao, texto: "Escreva a mensagem." };
    case "menu":
      return {
        id,
        tipo,
        posicao,
        texto: "Como posso ajudar?",
        opcoes: [
          { id: `${id}-o1`, rotulo: "Primeira opção" },
          { id: `${id}-o2`, rotulo: "Segunda opção" },
        ],
      };
    case "pergunta":
      return { id, tipo, posicao, texto: "Qual é o seu nome?", guardar_em: "nada" };
    case "marcar":
      return { id, tipo, posicao, tipo_id: null };
    case "proximos":
    case "remarcar_cancelar":
      return { id, tipo, posicao };
    case "recepcao":
      return {
        id,
        tipo,
        posicao,
        texto: "Certo! Vou chamar alguém da recepção, que já te responde por aqui.",
      };
    case "fim":
      return { id, tipo, posicao, texto: "" };
  }
}

/** O resumo de uma linha que o cartão mostra embaixo do nome. */
export function resumoDaCaixa(no: NoDoFluxo, nomeDoTipo: (id: string) => string | null): string {
  switch (no.tipo) {
    case "inicio":
      return "Primeira mensagem do paciente";
    case "mensagem":
    case "menu":
    case "pergunta":
    case "recepcao":
      return no.texto;
    case "fim":
      return no.texto || "Sem mensagem de despedida";
    case "marcar":
      return no.tipo_id
        ? (nomeDoTipo(no.tipo_id) ?? "Atendimento escolhido")
        : "O paciente escolhe o atendimento";
    case "proximos":
      return "Lista os horários marcados";
    case "remarcar_cancelar":
      return "Remarcar ou cancelar um horário";
  }
}

export type DadosDaCaixa = {
  no: NoDoFluxo;
  resumo: string;
  problemas?: string[];
};
export type NoDoCanvas = Node<DadosDaCaixa, "caixa">;

/** O cartão de uma caixa no canvas. */
export function CartaoDaCaixa({ id, data, selected }: NodeProps<NoDoCanvas>) {
  const t = useT();
  const visual = VISUAL[data.no.tipo];
  const Icone = visual.icone;
  const saidas = saidasDoNo(data.no);
  const temProblema = (data.problemas?.length ?? 0) > 0;
  // Uma saída só ("Depois") continua sendo a bolinha de baixo: não há o que rotular.
  const umaSaida = saidas.length === 1 && saidas[0]!.id === SAIDA_SEGUIR;

  return (
    <div
      className={cn(
        "w-60 rounded-md border border-l-4 border-border bg-surface shadow-sm transition-shadow",
        visual.borda,
        selected && "ring-2 ring-accent-500 ring-offset-1 ring-offset-bg",
        temProblema && "border-error ring-2 ring-error ring-offset-1 ring-offset-bg",
      )}
      data-testid={`chatbot-caixa-${id}`}
    >
      {data.no.tipo !== "inicio" && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            visual.chip,
          )}
        >
          <Icone size={14} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{t(visual.nome)}</p>
          <p className="line-clamp-2 text-xs break-words text-text-muted" title={data.resumo}>
            {data.resumo}
          </p>
        </div>
      </div>
      {temProblema && (
        <p className="flex items-start gap-1 border-t border-error/30 px-3 py-1.5 text-xs leading-snug text-error-fg">
          <Warning size={12} aria-hidden className="mt-0.5 shrink-0" />
          {t(data.problemas![0]!)}
        </p>
      )}
      {!umaSaida && saidas.length > 0 && (
        <ul className="border-t border-border">
          {saidas.map((saida) => (
            <li
              key={saida.id}
              className="relative flex items-center gap-1.5 border-t border-border/60 px-3 py-1 first:border-t-0"
              data-testid={`chatbot-saida-${id}-${saida.id}`}
            >
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
              <span className="line-clamp-2 text-xs leading-tight break-words">
                {t(saida.rotulo)}
              </span>
              <Handle
                type="source"
                id={saida.id}
                position={Position.Right}
                style={{ top: "50%" }}
              />
            </li>
          ))}
        </ul>
      )}
      {umaSaida && <Handle type="source" id={SAIDA_SEGUIR} position={Position.Bottom} />}
    </div>
  );
}
