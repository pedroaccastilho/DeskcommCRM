"use client";

/**
 * O relatório por origem na tela: período, o total e cada origem com o médico, o influenciador
 * ou o anúncio por baixo. Lê `GET /api/v1/clinica/relatorios/origens`, que já devolve tudo
 * consolidado na ordem da lista da clínica.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { periodoDoAtalho, type AtalhoDePeriodo } from "@/lib/clinica/origem-na-tela";
import type { Contagem, LinhaPorOrigem } from "@/lib/clinica/origens";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type Relatorio = {
  periodo: { de: string; ate: string };
  origens: LinhaPorOrigem[];
  total: Contagem;
};

const ATALHOS: Array<{ id: AtalhoDePeriodo; rotulo: string }> = [
  { id: "este_mes", rotulo: "Este mês" },
  { id: "mes_passado", rotulo: "Mês passado" },
  { id: "ultimos_90", rotulo: "Últimos 90 dias" },
];

const COLUNAS = "sm:grid-cols-[minmax(0,1fr)_6rem_9rem_6rem_9rem]";

function conversao(pct: number | null): string {
  return pct === null ? "—" : `${pct}%`;
}

export function RelatorioDeOrigens() {
  const t = useT();
  const [periodo, setPeriodo] = React.useState(() => periodoDoAtalho("este_mes"));
  const atalhoAtual = ATALHOS.find((a) => {
    const p = periodoDoAtalho(a.id);
    return p.de === periodo.de && p.ate === periodo.ate;
  })?.id;

  const relatorio = useQuery({
    queryKey: ["clinica", "relatorio-origens", periodo.de, periodo.ate],
    enabled: Boolean(periodo.de && periodo.ate),
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Relatorio }>(
          `/api/v1/clinica/relatorios/origens?de=${periodo.de}&ate=${periodo.ate}`,
        )
      ).data,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3" data-testid="periodo-do-relatorio">
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("Período")}>
          {ATALHOS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={atalhoAtual === a.id}
              onClick={() => setPeriodo(periodoDoAtalho(a.id))}
              className={cn(
                "h-9 rounded-sm border px-3 text-sm transition-colors",
                atalhoAtual === a.id
                  ? "border-accent bg-accent-soft text-text"
                  : "border-border text-text-muted hover:border-border-strong hover:text-text",
              )}
            >
              {t(a.rotulo)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor="relatorio-de" className="text-xs text-text-muted">
              {t("De")}
            </Label>
            <Input
              id="relatorio-de"
              type="date"
              className="h-9 w-40 px-2"
              value={periodo.de}
              max={periodo.ate}
              onChange={(e) => setPeriodo((p) => ({ ...p, de: e.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="relatorio-ate" className="text-xs text-text-muted">
              {t("Até")}
            </Label>
            <Input
              id="relatorio-ate"
              type="date"
              className="h-9 w-40 px-2"
              value={periodo.ate}
              min={periodo.de}
              onChange={(e) => setPeriodo((p) => ({ ...p, ate: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {relatorio.error instanceof ApiError ? (
        <Card className="p-4 text-sm text-error-fg" role="alert">
          {relatorio.error.message}
        </Card>
      ) : relatorio.data ? (
        <Conteudo relatorio={relatorio.data} />
      ) : null}
    </div>
  );
}

function Conteudo({ relatorio }: { relatorio: Relatorio }) {
  const t = useT();
  const { total, origens } = relatorio;
  const numeros = [
    { rotulo: "Pacientes novos", valor: String(total.novos), id: "total-novos" },
    { rotulo: "Compraram pacote", valor: String(total.com_pacote), id: "total-com-pacote" },
    { rotulo: "Conversão", valor: conversao(total.conversao_pct), id: "total-conversao" },
    {
      rotulo: "Vendido em pacotes",
      valor: formatCents(total.pacotes_valor_cents, "BRL"),
      id: "total-valor",
    },
  ];

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {numeros.map((n) => (
          <Card key={n.id} className="grid gap-1 p-4">
            <dt className="text-sm text-text-muted">{t(n.rotulo)}</dt>
            <dd data-testid={n.id} className="text-2xl font-semibold tabular-nums text-text">
              {n.valor}
            </dd>
          </Card>
        ))}
      </dl>

      {total.novos === 0 && (
        <p className="text-sm text-text-muted" data-testid="relatorio-vazio">
          {t("Nenhum paciente novo neste período.")}
        </p>
      )}

      <Card className="p-0">
        <div
          aria-hidden
          className={cn(
            "hidden gap-4 border-b border-border px-4 py-2 text-sm text-text-muted sm:grid",
            COLUNAS,
          )}
        >
          <span>{t("Origem")}</span>
          <span className="text-right">{t("Novos")}</span>
          <span className="text-right">{t("Compraram pacote")}</span>
          <span className="text-right">{t("Conversão")}</span>
          <span className="text-right">{t("Vendido")}</span>
        </div>
        <ul className="divide-y divide-border">
          {origens.map((o) => (
            <li
              key={o.origem_id ?? "sem-origem"}
              data-testid="linha-da-origem"
              data-origem={o.nome}
              className="grid gap-2 px-4 py-3"
            >
              <Linha nome={t(o.nome)} c={o} principal />
              {o.automaticos > 0 && (
                <p className="text-sm text-text-muted" data-testid="automaticos">
                  {t(
                    o.automaticos === 1
                      ? "{n} chegou sozinho pelo WhatsApp, sem a recepção registrar."
                      : "{n} chegaram sozinhos pelo WhatsApp, sem a recepção registrar.",
                  ).replace("{n}", String(o.automaticos))}
                </p>
              )}
              {o.origem_id === null && (
                <p className="text-sm text-text-muted">
                  {t("Registre a origem na ficha de cada paciente para ele entrar na conta certa.")}
                </p>
              )}
              {o.detalhes.length > 0 && (
                <ul className="grid gap-1 border-l-2 border-border pl-3" data-testid="detalhes">
                  {o.detalhes.map((d) => (
                    <li key={d.detalhe} data-testid="linha-do-detalhe" data-detalhe={d.detalhe}>
                      <Linha nome={d.detalhe} c={d} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Uma linha de números. No celular, cada número leva o próprio rótulo. */
function Linha({ nome, c, principal = false }: { nome: string; c: Contagem; principal?: boolean }) {
  const t = useT();
  const celulas = [
    { rotulo: "Novos", valor: String(c.novos) },
    { rotulo: "Compraram pacote", valor: String(c.com_pacote) },
    { rotulo: "Conversão", valor: conversao(c.conversao_pct) },
    { rotulo: "Vendido", valor: formatCents(c.pacotes_valor_cents, "BRL") },
  ];
  return (
    <div
      className={cn(
        "grid grid-cols-2 items-baseline gap-x-4 gap-y-1 sm:gap-4",
        COLUNAS,
        principal ? "text-sm" : "text-sm text-text-muted",
      )}
    >
      <span
        className={cn(
          "col-span-2 min-w-0 break-words sm:col-span-1",
          principal ? "font-medium text-text" : "",
        )}
      >
        {nome}
      </span>
      {celulas.map((cel) => (
        <span key={cel.rotulo} className="flex justify-between gap-2 tabular-nums sm:justify-end">
          <span className="text-text-muted sm:sr-only">{t(cel.rotulo)}</span>
          <span>{cel.valor}</span>
        </span>
      ))}
    </div>
  );
}
