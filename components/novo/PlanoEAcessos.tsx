"use client";

/**
 * Dois cartões da ficha na interface nova:
 *
 * - o PLANO DE TRATAMENTO de cada modalidade ("Sessão 3 de 10", etapa, reavaliação marcada),
 *   criado pela avaliação assinada. É o pedaço não clínico da avaliação: todo perfil lê, porque a
 *   recepção marca as sessões por ele (`GET /api/v1/clinica/planos`, mesma chave da versão atual);
 * - QUEM ABRIU o prontuário, e quando (`GET /api/v1/clinica/acessos`). Só aparece para quem o
 *   servidor deixa ler (`ve_acessos` em `/clinica/eu`); ler na tela ou baixar o PDF grava uma linha.
 */
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { usePlanosDoPaciente } from "@/components/clinica/PlanoDeTratamento";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { ROTULO_DA_MODALIDADE } from "@/lib/clinica/vocabulario";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/lib/i18n/IdiomaProvider";

import { PontoDaModalidade, dataCurta, hora } from "./pecas";

const ROTULO_DA_ETAPA: Record<string, string> = {
  avaliado: "Avaliado",
  em_tratamento: "Em tratamento",
  alta: "Alta",
};

export function CartaoDoPlano({ contactId, fuso }: { contactId: string; fuso: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const planos = usePlanosDoPaciente(contactId, true);
  const ativos = (planos.data ?? []).filter((p) => p.situacao === "ativo");
  // Sem o módulo (409) ou sem plano nenhum, o cartão não ocupa a coluna.
  if (planos.isError || ativos.length === 0) return null;

  return (
    <section className="n-cartao p-5" data-testid="novo-plano">
      <h2 className="mb-3 text-[15px] font-bold">{t("Plano de tratamento")}</h2>
      <ul className="grid gap-4">
        {ativos.map((p) => {
          const total = p.sessoes_previstas;
          return (
            <li key={p.id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <PontoDaModalidade modalidade={p.modalidade} />
                  {t(ROTULO_DA_MODALIDADE[p.modalidade])}
                </span>
                {p.etapa && (
                  <span className="n-selo n-selo-neutro">
                    {t(ROTULO_DA_ETAPA[p.etapa] ?? p.etapa)}
                  </span>
                )}
              </div>
              <p className="n-titulo n-numero mt-1 text-[22px] leading-tight">
                {total
                  ? `${t("Sessão")} ${Math.min(p.sessao_atual, total)} ${t("de")} ${total}`
                  : `${p.sessoes_feitas} ${p.sessoes_feitas === 1 ? t("sessão feita") : t("sessões feitas")}`}
              </p>
              {total ? (
                <div className="mt-2 flex gap-1" aria-hidden>
                  {Array.from({ length: total }, (_, i) => (
                    <span
                      key={i}
                      className="h-2 flex-1 rounded-full"
                      style={{
                        background:
                          i < p.sessoes_feitas
                            ? `var(--agenda-modalidade-${p.modalidade})`
                            : "var(--n-papel-2)",
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <p className="n-suave mt-1.5 text-xs">
                {p.frequencia_semanal ? `${p.frequencia_semanal}x ${t("por semana")} · ` : ""}
                {t("avaliado por")} {p.avaliador_nome}
              </p>
              {p.retorno.inicio && !p.retorno.cancelado ? (
                <p className="mt-1 text-xs font-semibold">
                  {t("Reavaliação marcada")}: {dataCurta(p.retorno.inicio, fuso, tag)},{" "}
                  {hora(p.retorno.inicio, fuso)}
                </p>
              ) : p.reavaliacao_em ? (
                <p className="mt-1 text-xs font-semibold text-[var(--n-aviso)]">
                  {t("Reavaliação prevista para")}{" "}
                  {new Intl.DateTimeFormat(tag, {
                    day: "numeric",
                    month: "long",
                    timeZone: "UTC",
                  }).format(new Date(`${p.reavaliacao_em}T12:00:00Z`))}{" "}
                  · {t("ainda sem horário")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface Acesso {
  id: string;
  user_id: string | null;
  nome: string | null;
  acessado_em: string;
}

const VISIVEIS = 6;

export function CartaoDeAcessos({ contactId, fuso }: { contactId: string; fuso: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [todos, setTodos] = React.useState(false);
  const acessos = useQuery({
    queryKey: ["clinica", "acessos", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Acesso[] }>(
          `/api/v1/clinica/acessos?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
    retry: false,
  });
  if (acessos.error instanceof ApiError && acessos.error.status === 403) return null;
  const lista = acessos.data ?? [];
  const visiveis = todos ? lista : lista.slice(0, VISIVEIS);

  return (
    <section className="n-cartao p-5" data-testid="novo-acessos">
      <h2 className="text-[15px] font-bold">{t("Quem abriu este prontuário")}</h2>
      <p className="n-fraco mt-0.5 mb-3 text-xs">
        {t("Cada leitura na tela e cada PDF baixado ficam registrados.")}
      </p>
      {acessos.isLoading ? null : lista.length === 0 ? (
        <p className="n-suave text-sm">{t("Ninguém abriu este prontuário ainda.")}</p>
      ) : (
        <>
          <ul className="grid gap-2">
            {visiveis.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-semibold">
                  {a.nome ?? t("Profissional removido")}
                </span>
                <span className="n-suave n-inicial flex-none text-xs">
                  {dataCurta(a.acessado_em, fuso, tag)} · {hora(a.acessado_em, fuso)}
                </span>
              </li>
            ))}
          </ul>
          {lista.length > VISIVEIS && (
            <button
              type="button"
              className="n-botao n-botao-suave n-botao-pequeno mt-3"
              onClick={() => setTodos(!todos)}
            >
              {todos ? t("Mostrar menos") : t("Ver todos")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
