"use client";

/**
 * MULTAS na interface nova: o cartão da ficha (as multas do paciente, com a sessão que as gerou)
 * e a folha de ISENTAR, com motivo curto opcional. Quem cria a multa é o servidor, ao cancelar em
 * cima da hora, e ela nasce "a cobrar". Administrador, Gerente e Recepção decidem se o paciente
 * paga: isentam (atestado, imprevisto aceito) ou voltam a cobrar uma isenta
 * (`lib/clinica/multas.ts`). Rotas: `GET /api/v1/clinica/multas`,
 * `POST /api/v1/clinica/multas/{id}/isentar` e `POST /api/v1/clinica/multas/{id}/cobrar`.
 *
 * "Somente leitura" não vê: o valor é financeiro, e a rota responde 403.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { decideMulta } from "@/lib/clinica/multas";
import { formatCents } from "@/lib/money";

import { pagamentoDe } from "@/lib/clinica/pagamentos";

import { useNovo } from "./Casca";
import { usePagamentosDoPaciente, useRecarregar } from "./dados";
import { SituacaoDoPagamento } from "./Pagamentos";
import { Folha, dataCurta, hora } from "./pecas";

export interface MultaDaClinica {
  id: string;
  appointment_id: string;
  contact_id: string;
  percentual: number;
  valor_cents: number | null;
  currency: string;
  status: "pendente" | "isenta" | "paga";
  /** De onde veio (9011): cancelamento em cima da hora ou falta. Ausente em módulo antigo. */
  origem?: "cancelamento" | "falta";
  isencao_motivo: string | null;
  created_at: string;
  calendar_appointments: { title: string | null; starts_at: string } | null;
  contacts: { name: string | null; display_name: string | null } | null;
}

export function valorDaMulta(m: MultaDaClinica, t: (s: string) => string): string {
  return m.valor_cents === null
    ? t("{pct}% do valor da sessão").replace("{pct}", String(m.percentual))
    : t("{valor}, {pct}% do valor da sessão")
        .replace("{valor}", formatCents(m.valor_cents, m.currency))
        .replace("{pct}", String(m.percentual));
}

/** As multas do paciente. A mesma chave serve o cartão e o histórico da ficha. */
export function useMultasDoPaciente(contactId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "multas", "paciente", contactId],
    enabled: habilitado,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<{ data: MultaDaClinica[] }>(
          `/api/v1/clinica/multas?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
  });
}

/**
 * A MULTA NA LINHA DO HISTÓRICO da ficha (pedido do Pedro, 2026-10-15: "só aparece se ele faltou,
 * mas não tem opção [...] pra marcar se vai cobrar ou não"). Em cada falta e cancelamento com multa:
 * a situação, isentar ou voltar a cobrar, e o pagamento. Na falta sem multa: lançar a multa da falta
 * (a mesma rota da folha da sessão). Cancelamento sem multa (no prazo, ou desmarcado pela clínica)
 * não tem o que cobrar. Decide quem decide a multa (`decideMulta`); o pagamento segue
 * `registraPagamento`, dentro de `SituacaoDoPagamento`.
 */
export function MultaDaSessao({
  sessaoId,
  situacao,
  multa,
  descricao,
}: {
  sessaoId: string;
  situacao: string;
  multa: MultaDaClinica | null;
  descricao: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const recarregar = useRecarregar();
  const { role, eu, soOlhar } = useNovo();
  const decide = !soOlhar && decideMulta(role, eu?.cargos ?? []);
  const [isentar, setIsentar] = React.useState(false);
  const pagamentos = usePagamentosDoPaciente(multa?.contact_id ?? "", multa !== null);
  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ["clinica", "multas"] });
    void qc.invalidateQueries({ queryKey: ["agenda", "clinica-multas"] });
    recarregar();
  };
  const cobrar = useMutation({
    mutationFn: async (id: string) =>
      apiClient.post(`/api/v1/clinica/multas/${encodeURIComponent(id)}/cobrar`, {}),
    onSuccess: () => {
      toast.success(t("A multa voltou a ser cobrada."));
      invalidar();
    },
    onError: (e) => showApiError(e),
  });
  const lancar = useMutation({
    mutationFn: async () =>
      apiClient.post(`/api/v1/clinica/agenda/${encodeURIComponent(sessaoId)}/multa-da-falta`, {}),
    onSuccess: () => {
      toast.success(t("Multa da falta lançada, a cobrar."));
      invalidar();
    },
    onError: (e) => showApiError(e),
  });

  if (role === "viewer") return null;
  if (!multa) {
    if (situacao !== "no_show") return null;
    return (
      <span
        className="flex flex-wrap items-center justify-end gap-2"
        data-testid="novo-historico-multa"
      >
        <span className="n-fraco text-xs">{t("Sem multa")}</span>
        {decide && (
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            disabled={lancar.isPending}
            onClick={() => lancar.mutate()}
            data-testid="novo-historico-cobrar-falta"
          >
            {t("Cobrar multa pela falta")}
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      className="flex flex-wrap items-center justify-end gap-2"
      data-testid="novo-historico-multa"
    >
      {multa.status === "pendente" && (
        <span className="n-selo n-selo-aviso">
          {t("Multa a cobrar")}
          {multa.valor_cents !== null ? ` · ${formatCents(multa.valor_cents, multa.currency)}` : ""}
        </span>
      )}
      {multa.status === "isenta" && (
        <span className="n-selo n-selo-neutro">{t("Multa isenta")}</span>
      )}
      {decide && multa.status === "pendente" && (
        <button
          type="button"
          className="n-botao n-botao-suave n-botao-pequeno"
          onClick={() => setIsentar(true)}
          data-testid="novo-historico-isentar"
        >
          {t("Não cobrar (isentar)")}
        </button>
      )}
      {decide && multa.status === "isenta" && (
        <button
          type="button"
          className="n-botao n-botao-suave n-botao-pequeno"
          disabled={cobrar.isPending}
          onClick={() => cobrar.mutate(multa.id)}
          data-testid="novo-historico-voltar-a-cobrar"
        >
          {t("Voltar a cobrar")}
        </button>
      )}
      {pagamentos.data && multa.status !== "isenta" && (
        <SituacaoDoPagamento
          alvo={{ multa_id: multa.id }}
          pagamento={pagamentoDe(pagamentos.data, { multa_id: multa.id })}
          valorCents={multa.valor_cents}
          moeda={multa.currency}
          descricao={`${t("Multa")} · ${descricao}`}
          compacta
          seloAPagar={false}
        />
      )}
      {isentar && <FolhaIsentarMulta multa={multa} aoFechar={() => setIsentar(false)} />}
    </span>
  );
}

export function CartaoDeMultas({ contactId, fuso }: { contactId: string; fuso: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const qc = useQueryClient();
  const recarregar = useRecarregar();
  const { role, eu, soOlhar } = useNovo();
  const decide = !soOlhar && decideMulta(role, eu?.cargos ?? []);
  const [isentar, setIsentar] = React.useState<MultaDaClinica | null>(null);
  const pagamentos = usePagamentosDoPaciente(contactId, role !== "viewer");
  const cobrar = useMutation({
    mutationFn: async (m: MultaDaClinica) =>
      apiClient.post(`/api/v1/clinica/multas/${encodeURIComponent(m.id)}/cobrar`, {}),
    onSuccess: () => {
      toast.success(t("A multa voltou a ser cobrada."));
      void qc.invalidateQueries({ queryKey: ["clinica", "multas"] });
      void qc.invalidateQueries({ queryKey: ["agenda", "clinica-multas"] });
      recarregar();
    },
    onError: (e) => showApiError(e),
  });
  const multas = useMultasDoPaciente(contactId, role !== "viewer");
  // Pendentes primeiro; dentro de cada grupo, a sessão mais recente no topo.
  const lista = [...(multas.data ?? [])].sort(
    (a, b) =>
      Number(b.status === "pendente") - Number(a.status === "pendente") ||
      (b.calendar_appointments?.starts_at ?? b.created_at).localeCompare(
        a.calendar_appointments?.starts_at ?? a.created_at,
      ),
  );
  if (role === "viewer" || multas.error instanceof ApiError || lista.length === 0) return null;
  const pendentes = lista.filter((m) => m.status === "pendente");

  return (
    <section className="n-cartao p-5" data-testid="novo-multas">
      <h2 className="mb-3 flex items-center justify-between text-[15px] font-bold">
        {t("Multas")}
        {pendentes.length > 0 && (
          <span className="n-selo n-selo-aviso">
            {pendentes.length} {t("em aberto")}
          </span>
        )}
      </h2>
      <ul className="grid gap-4">
        {lista.slice(0, 6).map((m) => {
          const s = m.calendar_appointments;
          return (
            <li key={m.id} data-testid="novo-multa">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold">
                  {s ? `${dataCurta(s.starts_at, fuso, tag)} · ${hora(s.starts_at, fuso)}` : "—"}
                </span>
                <span
                  className={`n-selo ${m.status === "pendente" ? "n-selo-aviso" : "n-selo-neutro"}`}
                >
                  {m.status === "pendente"
                    ? t("A cobrar")
                    : m.status === "isenta"
                      ? t("Isenta")
                      : t("Paga")}
                </span>
              </div>
              <p className="n-suave text-xs">
                {m.origem === "falta" ? `${t("Falta")} · ` : ""}
                {s?.title ? `${s.title} · ` : ""}
                {valorDaMulta(m, t)}
              </p>
              {pagamentos.data && m.status !== "isenta" && (
                <SituacaoDoPagamento
                  alvo={{ multa_id: m.id }}
                  pagamento={pagamentoDe(pagamentos.data, { multa_id: m.id })}
                  valorCents={m.valor_cents}
                  moeda={m.currency}
                  descricao={`${t("Multa")} · ${valorDaMulta(m, t)}`}
                  seloAPagar={false}
                />
              )}
              {m.status === "isenta" && m.isencao_motivo && (
                <p className="n-fraco mt-0.5 text-xs">
                  {t("Motivo")}: {m.isencao_motivo}
                </p>
              )}
              {decide && m.status === "pendente" && (
                <button
                  type="button"
                  className="n-botao n-botao-suave n-botao-pequeno mt-2"
                  onClick={() => setIsentar(m)}
                  data-testid="novo-isentar-multa"
                >
                  {t("Não cobrar (isentar)")}
                </button>
              )}
              {decide && m.status === "isenta" && (
                <button
                  type="button"
                  className="n-botao n-botao-suave n-botao-pequeno mt-2"
                  disabled={cobrar.isPending}
                  onClick={() => cobrar.mutate(m)}
                  data-testid="novo-cobrar-multa"
                >
                  {t("Voltar a cobrar")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {isentar && <FolhaIsentarMulta multa={isentar} aoFechar={() => setIsentar(null)} />}
    </section>
  );
}

/** Montada a cada abertura: o motivo nasce em branco. */
export function FolhaIsentarMulta({
  multa,
  aoFechar,
}: {
  multa: MultaDaClinica;
  aoFechar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const recarregar = useRecarregar();
  const [motivo, setMotivo] = React.useState("");
  const nome = rotuloDoContato(multa.contacts, t);

  const isentar = useMutation({
    mutationFn: async () =>
      apiClient.post(`/api/v1/clinica/multas/${encodeURIComponent(multa.id)}/isentar`, {
        motivo: motivo.trim(),
      }),
    onSuccess: () => {
      toast.success(t("Multa isenta."));
      void qc.invalidateQueries({ queryKey: ["clinica", "multas"] });
      void qc.invalidateQueries({ queryKey: ["agenda", "clinica-multas"] });
      recarregar();
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={t("Isentar multa")}
      subtitulo={`${nome} · ${valorDaMulta(multa, t)}`}
      testid="novo-folha-isentar-multa"
    >
      <div className="grid gap-5">
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("Motivo da isenção (opcional)")}</span>
          <textarea
            className="n-campo min-h-[96px] py-3"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t("Ex.: trouxe atestado médico")}
            autoFocus
            data-testid="novo-motivo-isencao"
          />
          <span className="n-fraco text-xs">
            {t(
              "O paciente não paga esta multa. O motivo, quem isentou e quando ficam registrados.",
            )}
          </span>
        </label>
        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={(motivo.trim().length > 0 && motivo.trim().length < 3) || isentar.isPending}
          onClick={() => isentar.mutate()}
          data-testid="novo-confirmar-isencao"
        >
          {isentar.isPending ? t("Salvando…") : t("Isentar multa")}
        </button>
      </div>
    </Folha>
  );
}
