"use client";

/**
 * O PLANO DE TRATAMENTO NA FICHA DO PACIENTE — o lado de tela da migration 9006. Fica acima das
 * abas, então aparece também com o prontuário aberto; telas novas (o "Meu dia", o Balcão) reusam
 * `PlanoDeTratamento` e `usePlanosDoPaciente`.
 *
 * Um cartão por modalidade com plano ativo: "Sessão 6 de 10" com a barra de progresso, a
 * frequência, quem avaliou, a etapa (avaliado, em tratamento, alta) e o retorno de reavaliação
 * marcado. Nada clínico aparece aqui: a recepção vê o mesmo cartão que o fisioterapeuta.
 * Quando o retorno não saiu como pedido, o cartão diz o que a recepção precisa fazer (e a tarefa
 * já está na lista de Tarefas).
 *
 * Sem plano, não mostra nada: um contato de vendas continua com a ficha de sempre.
 */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { dataDeParede } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import { corDaModalidade } from "@/lib/clinica/cores-da-agenda";
import type { EtapaDoPaciente, SituacaoDoRetorno } from "@/lib/clinica/plano-de-tratamento";
import { MOTIVOS_DE_ALTA, ROTULO_DA_MODALIDADE, type Modalidade } from "@/lib/clinica/vocabulario";

export type PlanoDaFicha = {
  id: string;
  modalidade: Modalidade;
  situacao: "ativo" | "alta";
  etapa: EtapaDoPaciente | null;
  avaliador_nome: string;
  sessoes_previstas: number | null;
  sessoes_feitas: number;
  sessao_atual: number;
  frequencia_semanal: number | null;
  reavaliacao_em: string | null;
  alta_motivo: string | null;
  avaliado_em: string;
  encerrado_em: string | null;
  retorno: {
    situacao: SituacaoDoRetorno;
    aviso: "nao_enviado" | "enviado" | "nao_deu";
    appointment_id: string | null;
    inicio: string | null;
    fuso: string | null;
    cancelado: boolean;
  };
};

export function chaveDosPlanos(contactId: string) {
  return ["clinica", "planos", contactId] as const;
}

export function usePlanosDoPaciente(contactId: string, habilitado: boolean) {
  return useQuery({
    queryKey: chaveDosPlanos(contactId),
    enabled: habilitado,
    staleTime: 30_000,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<{ data: PlanoDaFicha[] }>(
          `/api/v1/clinica/planos?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
  });
}

const ROTULO_DA_ETAPA: Record<EtapaDoPaciente, string> = {
  avaliado: "Avaliado",
  em_tratamento: "Em tratamento",
  alta: "Alta",
};

const VARIANTE_DA_ETAPA: Record<EtapaDoPaciente, "info" | "success" | "neutral"> = {
  avaliado: "info",
  em_tratamento: "success",
  alta: "neutral",
};

/** `AAAA-MM-DD` → data local, sem passar por UTC (senão 20/11 vira 19/11 no Brasil). */
function dataCivil(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a!, m! - 1, d!);
}

function LinhaDoRetorno({ plano }: { plano: PlanoDaFicha }) {
  const t = useT();
  const locale = useLocaleDeData();
  const r = plano.retorno;
  if (r.situacao === "nao_pedido" || !plano.reavaliacao_em) {
    return <p className="text-sm text-text-muted">{t("Reavaliação sem data definida.")}</p>;
  }
  const pedida = format(dataCivil(plano.reavaliacao_em), t("d 'de' MMMM"), { locale });

  if ((r.situacao === "marcado" || r.situacao === "marcado_outro_dia") && r.inicio) {
    const quando = format(
      dataDeParede(new Date(r.inicio), r.fuso ?? "UTC"),
      t("EEEE, d 'de' MMMM, HH:mm"),
      {
        locale,
      },
    );
    return (
      <div className="grid gap-1 text-sm" data-testid="plano-retorno">
        <p className="text-text">
          <span className="font-medium">{t("Retorno marcado:")}</span>{" "}
          <span className="first-letter:uppercase">{quando}</span>{" "}
          {r.appointment_id ? (
            <Link
              href={`/app/agenda?compromisso=${r.appointment_id}`}
              className="font-medium underline underline-offset-2"
            >
              {t("Ver na agenda")}
            </Link>
          ) : null}
        </p>
        {r.situacao === "marcado_outro_dia" ? (
          <p className="text-warning-fg">
            {t(
              "O dia pedido ({dia}) estava cheio; o sistema reservou o horário livre mais próximo.",
            ).replace("{dia}", pedida)}
          </p>
        ) : null}
        {r.aviso === "enviado" ? (
          <p className="text-text-muted">{t("Paciente avisado pelo WhatsApp.")}</p>
        ) : r.aviso === "nao_deu" ? (
          <p className="text-warning-fg">
            {t("A confirmação pelo WhatsApp não saiu. Avise o paciente.")}
          </p>
        ) : null}
      </div>
    );
  }

  if (r.cancelado) {
    return (
      <p className="text-sm text-warning-fg" data-testid="plano-retorno">
        {t("O retorno de reavaliação foi cancelado. Marque outro na agenda.")}
      </p>
    );
  }

  return (
    <p className="text-sm text-warning-fg" data-testid="plano-retorno">
      {r.situacao === "sem_tipo"
        ? t(
            "Reavaliação pedida para {dia}. Falta ligar um tipo de agendamento a esta modalidade; a recepção marca à mão.",
          ).replace("{dia}", pedida)
        : r.situacao === "a_marcar"
          ? t("Reavaliação pedida para {dia}. Marcando o retorno…").replace("{dia}", pedida)
          : t(
              "Reavaliação pedida para {dia}. Não havia horário livre; a recepção precisa marcar.",
            ).replace("{dia}", pedida)}
    </p>
  );
}

function CartaoDoPlano({ plano }: { plano: PlanoDaFicha }) {
  const t = useT();
  const locale = useLocaleDeData();
  const previstas = plano.sessoes_previstas;
  const progresso = previstas ? Math.min(1, plano.sessoes_feitas / previstas) : 0;
  const avaliadoEm = format(new Date(plano.avaliado_em), t("d 'de' MMMM"), { locale });
  const motivo = MOTIVOS_DE_ALTA.find((m) => m.valor === plano.alta_motivo)?.rotulo;

  return (
    <article
      data-testid={`plano-${plano.modalidade}`}
      className="grid gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-text-muted">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: corDaModalidade(plano.modalidade) }}
          />
          {t("Plano de tratamento")} · {t(ROTULO_DA_MODALIDADE[plano.modalidade])}
        </span>
        {plano.etapa ? (
          <Badge variant={VARIANTE_DA_ETAPA[plano.etapa]} data-testid="plano-etapa">
            {t(ROTULO_DA_ETAPA[plano.etapa])}
          </Badge>
        ) : null}
      </header>

      {plano.situacao === "alta" ? (
        <p className="text-lg font-semibold text-text">
          {t("Alta com {n} de {total} sessões")
            .replace("{n}", String(plano.sessoes_feitas))
            .replace("{total}", previstas ? String(previstas) : "—")}
          {motivo ? <span className="font-normal text-text-muted"> · {t(motivo)}</span> : null}
        </p>
      ) : previstas ? (
        <div className="grid gap-1.5">
          <p className="text-lg font-semibold text-text" data-testid="plano-sessao">
            {t("Sessão {n} de {total}")
              .replace("{n}", String(plano.sessao_atual))
              .replace("{total}", String(previstas))}
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-elevated"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={previstas}
            aria-valuenow={plano.sessoes_feitas}
            aria-label={t("Sessões feitas")}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(progresso * 100)}%`,
                backgroundColor: corDaModalidade(plano.modalidade),
              }}
            />
          </div>
          <p className="text-sm text-text-muted">
            {t(plano.sessoes_feitas === 1 ? "{n} sessão feita" : "{n} sessões feitas").replace(
              "{n}",
              String(plano.sessoes_feitas),
            )}
            {plano.sessoes_feitas > previstas
              ? ` · ${t("passou do previsto: hora de reavaliar")}`
              : ""}
          </p>
        </div>
      ) : (
        <p className="text-lg font-semibold text-text" data-testid="plano-sessao">
          {t(plano.sessoes_feitas === 1 ? "{n} sessão feita" : "{n} sessões feitas").replace(
            "{n}",
            String(plano.sessoes_feitas),
          )}
        </p>
      )}

      <p className="text-sm text-text-muted">
        {plano.frequencia_semanal
          ? `${t("{n}x por semana").replace("{n}", String(plano.frequencia_semanal))} · `
          : ""}
        {t("Avaliado por {nome} em {dia}")
          .replace("{nome}", plano.avaliador_nome)
          .replace("{dia}", avaliadoEm)}
      </p>

      {plano.situacao === "ativo" ? <LinhaDoRetorno plano={plano} /> : null}
    </article>
  );
}

export function PlanoDeTratamento({ contactId, ativo }: { contactId: string; ativo: boolean }) {
  const t = useT();
  const planos = usePlanosDoPaciente(contactId, ativo);
  if (!ativo || !planos.data || planos.data.length === 0) return null;
  const ativos = planos.data.filter((p) => p.situacao === "ativo");
  // Sem plano ativo, só a alta mais recente — o resto é história, que mora no prontuário.
  const visiveis = ativos.length > 0 ? ativos : planos.data.slice(0, 1);
  return (
    <section
      data-testid="plano-de-tratamento"
      aria-label={t("Plano de tratamento")}
      className="grid gap-3 sm:grid-cols-2"
    >
      {visiveis.map((p) => (
        <CartaoDoPlano key={p.id} plano={p} />
      ))}
    </section>
  );
}
