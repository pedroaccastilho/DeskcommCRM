"use client";

/**
 * O dia da equipe na Agenda — o lado de TELA de `lib/clinica/dia-da-equipe.ts`.
 *
 * A grade do núcleo sabe desenhar uma coluna por pessoa (`colunasPorPessoa`);
 * daqui saem as colunas (os profissionais da clínica, com a modalidade de cada
 * um sob o nome) e a linha de números que fica acima da grade.
 */
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { ColunaDePessoa } from "@/components/agenda/GradeDaAgenda";
import type { Agendamento, Pessoa } from "@/components/agenda/tipos";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { corDaModalidade } from "@/lib/clinica/cores-da-agenda";
import {
  colunasDaEquipe,
  resumoDoDia,
  type ProfissionalDaEquipe,
} from "@/lib/clinica/dia-da-equipe";
import { ROTULO_DA_MODALIDADE, type Modalidade } from "@/lib/clinica/vocabulario";

/** A mesma chave da tela de configurações, para as duas dividirem o cache. */
export function useProfissionaisDaEquipe(habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "profissionais"],
    queryFn: async () =>
      (await apiClient.get<{ data: ProfissionalDaEquipe[] }>("/api/v1/clinica/profissionais")).data,
    enabled: habilitado,
    staleTime: 60_000,
    retry: false,
  });
}

function rotuloDasModalidades(
  modalidades: readonly Modalidade[],
  t: (s: string) => string,
): string {
  return modalidades
    .map((m, i) => {
      const rotulo = t(ROTULO_DA_MODALIDADE[m]);
      return i === 0 ? rotulo : rotulo.toLocaleLowerCase();
    })
    .join(", ");
}

/** As colunas da grade, já com a linha de modalidade sob o nome. */
export function useColunasDaEquipe(entrada: {
  ativo: boolean;
  pessoas: Pessoa[];
  agendamentosDoDia: Agendamento[];
  isolada: string | null;
  /** Dono da agenda cujos horários livres a grade desenha (o do tipo escolhido). */
  donoDosHorarios: string | null;
}): ColunaDePessoa[] | undefined {
  const t = useT();
  const { ativo, pessoas, agendamentosDoDia, isolada, donoDosHorarios } = entrada;
  const { data: profissionais = [] } = useProfissionaisDaEquipe(ativo);

  return React.useMemo(() => {
    if (!ativo) return undefined;
    return colunasDaEquipe({ pessoas, profissionais, agendamentosDoDia, isolada }).map(
      ({ pessoa, modalidades }) => ({
        pessoa,
        detalhe:
          modalidades.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              {modalidades.map((m) => (
                <span
                  key={m}
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: corDaModalidade(m) }}
                />
              ))}
              <span className="truncate">{rotuloDasModalidades(modalidades, t)}</span>
            </span>
          ) : undefined,
        marcaAqui: pessoa.id === donoDosHorarios,
      }),
    );
  }, [ativo, pessoas, profissionais, agendamentosDoDia, isolada, donoDosHorarios, t]);
}

function contar(n: number, um: string, varios: string, t: (s: string) => string): string {
  return t(n === 1 ? um : varios).replace("{n}", String(n));
}

/**
 * A linha de números acima da grade: quantos atendimentos, quantos ainda sem
 * confirmação, quantas faltas e quanto de cada modalidade. Com a grade pintada
 * por modalidade, as bolinhas fazem as vezes de legenda.
 */
export function ResumoDoDia({
  agendamentosDoDia,
  comCores,
}: {
  agendamentosDoDia: Agendamento[];
  comCores: boolean;
}) {
  const t = useT();
  const resumo = resumoDoDia(agendamentosDoDia);

  return (
    <div
      data-testid="resumo-do-dia"
      role="group"
      aria-label={t("Números do dia")}
      className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm"
    >
      <span data-testid="resumo-total" className="font-semibold text-text">
        {contar(resumo.total, "{n} atendimento", "{n} atendimentos", t)}
      </span>
      {resumo.aguardando > 0 && (
        <span data-testid="resumo-aguardando" className="text-text">
          {t("{n} aguardando confirmação").replace("{n}", String(resumo.aguardando))}
        </span>
      )}
      {resumo.faltas > 0 && (
        <span data-testid="resumo-faltas" className="text-text-muted">
          {contar(resumo.faltas, "{n} falta", "{n} faltas", t)}
        </span>
      )}
      {resumo.porModalidade.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
          {resumo.porModalidade.map(({ modalidade, quantos }) => (
            <li
              key={modalidade ?? "outra"}
              data-testid={`resumo-modalidade-${modalidade ?? "outra"}`}
              className="flex items-center gap-1.5"
            >
              {comCores && (
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: corDaModalidade(modalidade) }}
                />
              )}
              {modalidade ? t(ROTULO_DA_MODALIDADE[modalidade]) : t("Outros")}
              <span className="text-text tabular-nums">{quantos}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
