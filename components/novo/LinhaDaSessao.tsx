"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { SessaoDaGrade } from "@/lib/clinica/agenda";
import { momentoDa, quantoFalta } from "@/lib/novo/hoje";

import { useNovo } from "./Casca";
import { useRecarregar } from "./dados";
import { seloDa } from "./FolhaDaSessao";
import { Avatar, PontoDaModalidade, hora } from "./pecas";

/**
 * Uma sessão na lista do dia: hora grande, paciente, o que é e com quem — e, quando cabe, UM
 * botão de um toque (confirmar, ou registrar que aconteceu). O resto abre na folha.
 */
export function LinhaDaSessao({
  sessao,
  agora,
  nomeDoProfissional,
  aoAbrir,
}: {
  sessao: SessaoDaGrade;
  agora: Date;
  nomeDoProfissional: string | null;
  aoAbrir: () => void;
}) {
  const { fuso, role, soAsMinhas } = useNovo();
  const recarregar = useRecarregar();
  const momento = momentoDa(sessao, agora);
  const selo = seloDa(sessao, agora);
  const nome = sessao.paciente?.nome ?? sessao.titulo;
  const encerrada = momento === "encerrada";

  const rapida = useMutation({
    mutationFn: async (status: "confirmed" | "completed") =>
      apiClient.patch("/api/v1/agenda/agendamentos", { id: sessao.id, status }),
    onSuccess: (_r, status) => {
      toast.success(status === "confirmed" ? "Presença confirmada." : "Sessão realizada.");
      recarregar();
    },
    onError: (err) => showApiError(err),
  });

  const acao =
    role === "viewer"
      ? null
      : momento === "sem_confirmacao"
        ? { rotulo: "Confirmar", status: "confirmed" as const }
        : momento === "para_fechar"
          ? { rotulo: "Realizado", status: "completed" as const }
          : null;

  return (
    <div
      className={`n-linha-clicavel items-center gap-3 px-3 py-3 sm:gap-4 ${encerrada ? "opacity-60" : ""}`}
      data-testid="novo-linha-sessao"
    >
      <button
        type="button"
        onClick={aoAbrir}
        className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-4"
      >
        <span className="w-14 flex-none">
          <span
            className={`n-titulo n-numero block text-[22px] leading-none ${encerrada ? "line-through decoration-1" : ""}`}
          >
            {hora(sessao.inicio, fuso)}
          </span>
          {!encerrada && momento !== "para_fechar" && (
            <span className="n-fraco mt-1 block text-[11px] font-semibold">
              {quantoFalta(new Date(sessao.inicio), agora)}
            </span>
          )}
        </span>
        <span
          className="h-10 w-1 flex-none rounded-full"
          style={{ background: `var(--agenda-modalidade-${sessao.modalidade ?? "outra"})` }}
          aria-hidden
        />
        <span className="hidden flex-none sm:block">
          <Avatar nome={nome} tamanho={40} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{nome}</span>
          <span className="n-suave flex items-center gap-1.5 truncate text-[13px]">
            <PontoDaModalidade modalidade={sessao.modalidade} />
            <span className="truncate">
              {sessao.tipo?.nome ?? sessao.titulo}
              {!soAsMinhas && nomeDoProfissional ? ` · ${nomeDoProfissional}` : ""}
            </span>
          </span>
        </span>
        <span className="hidden flex-none sm:block">
          <span className={`n-selo ${selo.classe}`}>{selo.rotulo}</span>
        </span>
      </button>
      {acao && (
        <button
          type="button"
          className="n-botao n-botao-escuro n-botao-pequeno"
          disabled={rapida.isPending}
          onClick={() => rapida.mutate(acao.status)}
        >
          {acao.rotulo}
        </button>
      )}
    </div>
  );
}
