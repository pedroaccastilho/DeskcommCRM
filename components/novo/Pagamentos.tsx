"use client";

/**
 * PAGAMENTO na interface nova (migration 9011): dizer se o paciente já pagou, e como, o pacote, a
 * sessão avulsa e a multa. Pedido do Pedro (2026-10-15).
 *
 * `SituacaoDoPagamento` é a linha que vai embaixo de cada coisa: "Pago · Pix · R$ 150" (com
 * "Desfazer") ou "A pagar" (com "Registrar pagamento"). A folha pergunta a forma (Pix, cartão de
 * crédito, cartão de débito, dinheiro) e o valor, já preenchido com o da coisa. É registro à mão:
 * não fala com maquininha nem banco.
 *
 * Registrar e desfazer é de Administrador, Gerente, Recepção e Financeiro
 * (`lib/clinica/pagamentos.ts`); os outros perfis só leem. Rotas: `GET`/`POST
 * /api/v1/clinica/pagamentos` e `DELETE /api/v1/clinica/pagamentos/{id}`.
 */
import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import {
  FORMAS_DE_PAGAMENTO,
  ROTULO_DA_FORMA,
  registraPagamento,
  type FormaDePagamento,
  type PagamentoDaClinica,
} from "@/lib/clinica/pagamentos";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { formatCents, parseReaisToCents } from "@/lib/money";

import { useNovo } from "./Casca";
import { useRecarregar } from "./dados";
import { Folha } from "./pecas";

/** O que está sendo pago: exatamente um. */
export type AlvoDoPagamento =
  { pacote_id: string } | { appointment_id: string } | { multa_id: string };

/** Quem pode registrar e desfazer, na tela (o servidor confere de novo). */
export function useRegistraPagamento(): boolean {
  const { role, eu, soOlhar } = useNovo();
  return !soOlhar && registraPagamento(role, eu?.cargos ?? []);
}

function centsParaCampo(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function rotuloDoPagamento(
  p: PagamentoDaClinica,
  t: (s: string) => string,
  tag: string,
): string {
  const dia = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    timeZone: "America/Sao_Paulo",
  })
    .format(new Date(p.pago_em))
    .replace(".", "");
  return [
    t("Pago"),
    t(ROTULO_DA_FORMA[p.forma]),
    p.valor_cents !== null ? formatCents(p.valor_cents, p.currency) : null,
    dia,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A situação do pagamento de uma coisa, com o botão que cabe a quem vê. Sem `pagamento` e sem
 * poder registrar, diz só "A pagar".
 */
export function SituacaoDoPagamento({
  alvo,
  pagamento,
  valorCents,
  moeda,
  descricao,
  compacta = false,
  seloAPagar = true,
}: {
  alvo: AlvoDoPagamento;
  pagamento: PagamentoDaClinica | null;
  /** O valor da coisa, que a folha sugere. */
  valorCents: number | null;
  moeda: string;
  /** O que aparece no topo da folha ("Pacote de 10 sessões", "Multa de 18/10"…). */
  descricao: string;
  compacta?: boolean;
  /** `false` onde a coisa já diz que está em aberto (a multa "A cobrar"). */
  seloAPagar?: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const registra = useRegistraPagamento();
  const recarregar = useRecarregar();
  const [registrando, setRegistrando] = React.useState(false);
  const desfazer = useMutation({
    mutationFn: async (id: string) =>
      apiClient.delete(`/api/v1/clinica/pagamentos/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(t("Pagamento desfeito. Voltou para a pagar."));
      recarregar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${compacta ? "" : "mt-2"}`}
      data-testid="novo-situacao-do-pagamento"
    >
      {pagamento ? (
        <>
          <span className="n-selo n-selo-ok" data-testid="novo-pago">
            {rotuloDoPagamento(pagamento, t, tag)}
          </span>
          {registra && (
            <button
              type="button"
              className="n-botao n-botao-suave n-botao-pequeno"
              disabled={desfazer.isPending}
              onClick={() => desfazer.mutate(pagamento.id)}
              data-testid="novo-desfazer-pagamento"
            >
              {t("Desfazer")}
            </button>
          )}
        </>
      ) : (
        <>
          {seloAPagar && (
            <span className="n-selo n-selo-aviso" data-testid="novo-a-pagar">
              {t("A pagar")}
            </span>
          )}
          {registra && (
            <button
              type="button"
              className="n-botao n-botao-suave n-botao-pequeno"
              onClick={() => setRegistrando(true)}
              data-testid="novo-registrar-pagamento"
            >
              {t("Registrar pagamento")}
            </button>
          )}
        </>
      )}
      {registrando && (
        <FolhaDePagamento
          alvo={alvo}
          valorCents={valorCents}
          moeda={moeda}
          descricao={descricao}
          aoFechar={() => setRegistrando(false)}
        />
      )}
    </div>
  );
}

/** Os botões da forma de pagamento, também usados na venda do pacote. */
export function EscolhaDaForma({
  forma,
  aoEscolher,
}: {
  forma: FormaDePagamento | null;
  aoEscolher: (f: FormaDePagamento) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("Forma de pagamento")}>
      {FORMAS_DE_PAGAMENTO.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={forma === f}
          onClick={() => aoEscolher(f)}
          className={`n-botao ${forma === f ? "n-botao-escuro" : "n-botao-suave"}`}
          data-testid={`novo-forma-${f}`}
        >
          {t(ROTULO_DA_FORMA[f])}
        </button>
      ))}
    </div>
  );
}

/** Montada a cada abertura: a forma nasce em branco e o valor, com o da coisa. */
export function FolhaDePagamento({
  alvo,
  valorCents,
  moeda,
  descricao,
  aoFechar,
}: {
  alvo: AlvoDoPagamento;
  valorCents: number | null;
  moeda: string;
  descricao: string;
  aoFechar: () => void;
}) {
  const t = useT();
  const recarregar = useRecarregar();
  const [forma, setForma] = React.useState<FormaDePagamento | null>(null);
  const [valor, setValor] = React.useState(centsParaCampo(valorCents));
  const valorDigitado = parseReaisToCents(valor);
  const valorInvalido = valor.trim() !== "" && valorDigitado === null;

  const registrar = useMutation({
    mutationFn: async () =>
      apiClient.post("/api/v1/clinica/pagamentos", {
        ...alvo,
        forma,
        // Em branco, o servidor usa o valor da coisa (o do pacote, o preço do tipo, o da multa).
        ...(valor.trim() === "" ? {} : { valor_cents: valorDigitado }),
      }),
    onSuccess: () => {
      toast.success(t("Pagamento registrado."));
      recarregar();
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={t("Registrar pagamento")}
      subtitulo={descricao}
      testid="novo-folha-pagamento"
    >
      <div className="grid gap-5">
        <div>
          <p className="n-rotulo">{t("Como o paciente pagou?")}</p>
          <EscolhaDaForma forma={forma} aoEscolher={setForma} />
        </div>
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">
            {t("Valor pago")} ({moeda})
          </span>
          <input
            className="n-campo"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0,00"
            data-testid="novo-valor-do-pagamento"
          />
          {valorInvalido && (
            <span className="text-xs text-[var(--n-alerta)]">{t("Valor inválido.")}</span>
          )}
        </label>
        <p className="n-fraco text-xs">
          {t("Só fica registrado aqui: o CRM não cobra nem fala com a maquininha ou o banco.")}
        </p>
        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={forma === null || valorInvalido || registrar.isPending}
          onClick={() => registrar.mutate()}
          data-testid="novo-confirmar-pagamento"
        >
          {registrar.isPending ? t("Salvando…") : t("Registrar pagamento")}
        </button>
      </div>
    </Folha>
  );
}
