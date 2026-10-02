"use client";

/**
 * A sessão da clínica dentro do painel do compromisso da Agenda.
 *
 * O núcleo desenha o painel; daqui saem as três coisas que a clínica acrescenta, e só quando o
 * compromisso é sessão da clínica (o tipo dele tem modalidade): o aviso da multa antes de cancelar,
 * a trava da falta durante a tolerância de atraso e a multa que o cancelamento gerou.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { useClinicaEu } from "@/components/clinica/ProntuarioDoPaciente";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PoliticaDaAgenda, SessaoDaGrade } from "@/lib/clinica/agenda";
import type { AvisoDoCancelamento } from "@/lib/clinica/sessao-no-detalhe";
import { formatarMoeda } from "@/lib/propostas/moeda";

type Grade = { sessoes: SessaoDaGrade[]; politica: PoliticaDaAgenda };

export type SessaoDaClinica = { sessao: SessaoDaGrade; politica: PoliticaDaAgenda };

/**
 * A sessão como a grade da clínica a vê, com os prazos da política já calculados no servidor.
 * `null` sem o módulo, fora de sessão da clínica ou enquanto carrega: o painel segue como o
 * núcleo o desenha.
 */
export function useSessaoDaClinica(
  compromisso: { id: string; starts_at: string; ends_at: string } | undefined,
): SessaoDaClinica | null {
  const { data: eu } = useClinicaEu();
  const ativo = !!eu?.instalado && !!compromisso;
  const { data } = useQuery({
    queryKey: ["agenda", "clinica-sessao", compromisso?.id, compromisso?.starts_at],
    enabled: ativo,
    retry: false,
    queryFn: async () => {
      const busca = new URLSearchParams({
        de: compromisso!.starts_at,
        ate: compromisso!.ends_at,
        incluir_canceladas: "1",
      });
      return (await apiClient.get<{ data: Grade }>(`/api/v1/clinica/agenda?${busca}`)).data;
    },
  });
  if (!ativo || !data) return null;
  const sessao = data.sessoes.find((s) => s.id === compromisso.id);
  if (!sessao?.modalidade) return null;
  return { sessao, politica: data.politica };
}

function useDataHora(fuso: string) {
  const tag = useTagDeIdioma();
  return React.useMemo(
    () =>
      new Intl.DateTimeFormat(tag, {
        timeZone: fuso,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    [tag, fuso],
  );
}

/** O aviso acima do botão de cancelar e a escolha de quem desmarcou. */
export function AvisoDeCancelamento({
  aviso,
  fuso,
  pelaClinica,
  onPelaClinica,
}: {
  aviso: AvisoDoCancelamento | null;
  fuso: string;
  pelaClinica: boolean;
  onPelaClinica: (v: boolean) => void;
}) {
  const t = useT();
  const formato = useDataHora(fuso);
  const comMulta = aviso?.tipo === "com_multa" && !pelaClinica;

  return (
    <div data-testid="aviso-de-cancelamento" className="space-y-2">
      {aviso?.tipo === "sem_multa" ? (
        <p className="text-sm text-text-muted">
          {t("Sem multa se cancelar até {data}.").replace("{data}", formato.format(aviso.ate))}
        </p>
      ) : null}
      {comMulta ? (
        <p
          data-testid="aviso-de-multa"
          className="rounded-md border border-warning bg-warning-bg px-3 py-2 text-sm text-warning-fg"
        >
          {t("Cancelar agora gera multa de {pct}% do valor da sessão.").replace(
            "{pct}",
            String(aviso.percentual),
          )}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid="cancelado-pela-clinica"
          className="h-4 w-4 accent-accent"
          checked={pelaClinica}
          onChange={(e) => onPelaClinica(e.target.checked)}
        />
        {t("Foi a clínica que desmarcou, sem multa")}
      </label>
    </div>
  );
}

/** A linha sob o botão de falta enquanto a tolerância de atraso não acabou. */
export function AvisoDaTolerancia({
  ate,
  fuso,
  minutos,
}: {
  ate: Date;
  fuso: string;
  minutos: number;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const hora = new Intl.DateTimeFormat(tag, {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ate);
  return (
    <p data-testid="aviso-de-tolerancia" className="text-sm text-text-muted">
      {t("A falta pode ser registrada a partir das {hora}, depois dos {min} minutos de tolerância.")
        .replace("{hora}", hora)
        .replace("{min}", String(minutos))}
    </p>
  );
}

type Multa = {
  id: string;
  appointment_id: string;
  percentual: number;
  valor_cents: number | null;
  currency: string;
  status: "pendente" | "isenta" | "paga";
  isencao_motivo: string | null;
};

/**
 * A multa que o cancelamento desta sessão gerou, com o botão de isentar. Quem não pode ver multas
 * (Somente leitura) recebe 403 e o quadro simplesmente não aparece.
 */
export function MultaDaSessao({
  appointmentId,
  contactId,
  podeIsentar,
}: {
  appointmentId: string;
  contactId: string;
  podeIsentar: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [motivo, setMotivo] = React.useState("");
  const [isentando, setIsentando] = React.useState(false);
  const chave = ["agenda", "clinica-multas", contactId];
  const { data: multas } = useQuery({
    queryKey: chave,
    retry: false,
    queryFn: async () =>
      (await apiClient.get<{ data: Multa[] }>(`/api/v1/clinica/multas?contact_id=${contactId}`))
        .data,
  });
  const isentar = useMutation({
    mutationFn: (id: string) =>
      apiClient.post(`/api/v1/clinica/multas/${id}/isentar`, { motivo: motivo.trim() }),
    onSuccess: () => {
      setMotivo("");
      setIsentando(false);
      void qc.invalidateQueries({ queryKey: chave });
    },
    onError: showApiError,
  });

  const multa = multas?.find((m) => m.appointment_id === appointmentId);
  if (!multa) return null;

  const valor =
    multa.valor_cents === null
      ? t("{pct}% do valor da sessão").replace("{pct}", String(multa.percentual))
      : t("{valor}, {pct}% do valor da sessão")
          .replace("{valor}", formatarMoeda(multa.valor_cents, multa.currency))
          .replace("{pct}", String(multa.percentual));
  const titulo = {
    pendente: "Multa pendente por cancelamento em cima da hora",
    isenta: "Multa isenta",
    paga: "Multa paga",
  }[multa.status];

  return (
    <div
      data-testid="multa-da-sessao"
      className={
        multa.status === "pendente"
          ? "space-y-2 rounded-lg border border-warning bg-warning-bg p-3 text-warning-fg"
          : "space-y-2 rounded-lg border p-3"
      }
    >
      <p className="font-medium">{t(titulo)}</p>
      <p data-testid="valor-da-multa" className="text-sm">
        {valor}
      </p>
      {multa.status === "isenta" && multa.isencao_motivo ? (
        <p className="text-sm text-text-muted">{multa.isencao_motivo}</p>
      ) : null}
      {podeIsentar && multa.status === "pendente" ? (
        isentando ? (
          <div className="space-y-2">
            <label className="block text-sm">
              {t("Motivo da isenção")}
              <input
                data-testid="motivo-da-isencao"
                className="mt-1 w-full rounded-md border bg-surface p-2 text-text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={motivo.trim().length < 3 || isentar.isPending}
                onClick={() => isentar.mutate(multa.id)}
              >
                {t("Isentar multa")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsentando(false)}>
                {t("Voltar")}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            data-testid="isentar-multa"
            onClick={() => setIsentando(true)}
          >
            {t("Isentar multa")}
          </Button>
        )
      ) : null}
    </div>
  );
}
