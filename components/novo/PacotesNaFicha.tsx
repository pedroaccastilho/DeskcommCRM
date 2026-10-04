"use client";

/**
 * PACOTES na ficha da interface nova: o saldo do que está valendo, a VENDA (com o aceite da
 * política de cancelamento, que fica gravado) e os ajustes de cada perfil. Congelar é da recepção;
 * prorrogar e cancelar são da gerência. As rotas e as contas são as da versão atual
 * (`/api/v1/clinica/pacotes`, `lib/clinica/pacotes-na-ficha.ts`); só a tela é nova.
 *
 * "Somente leitura" não vê o cartão: o valor é financeiro, e a rota responde 403.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  ajustesPermitidos,
  congeladoAte,
  corpoDaVenda,
  opcoesDeVenda,
  separarPacotes,
  type AjusteDoPacote,
  type OpcaoDeVenda,
  type PacoteDaFicha,
  type ProdutoDoCatalogo,
} from "@/lib/clinica/pacotes-na-ficha";
import { ROTULO_DA_MODALIDADE, type Modalidade } from "@/lib/clinica/vocabulario";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { formatCents, parseReaisToCents } from "@/lib/money";
import { randomId } from "@/lib/random-id";

import { useNovo } from "./Casca";
import { usePacotesDoPaciente, useRecarregar } from "./dados";
import { Folha, PontoDaModalidade } from "./pecas";

interface Politica {
  antecedencia_cancelamento_horas: number;
  multa_cancelamento_pct: number;
  tolerancia_atraso_minutos: number;
}

/** A política vem da grade da agenda, que todo perfil lê (mesma chave da versão atual). */
function usePolitica() {
  return useQuery({
    queryKey: ["clinica", "politica-de-cancelamento"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const de = new Date();
      const ate = new Date(de.getTime() + 60_000);
      const qs = new URLSearchParams({ de: de.toISOString(), ate: ate.toISOString() });
      return (await apiClient.get<{ data: { politica: Politica } }>(`/api/v1/clinica/agenda?${qs}`))
        .data.politica;
    },
  });
}

function useDia() {
  const tag = useTagDeIdioma();
  return React.useCallback(
    (iso: string, ano = false) =>
      new Intl.DateTimeFormat(tag, {
        day: "numeric",
        month: "long",
        ...(ano ? { year: "numeric" } : {}),
        timeZone: "UTC",
      }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)),
    [tag],
  );
}

export function CartaoDePacotes({ contactId }: { contactId: string }) {
  const t = useT();
  const dia = useDia();
  const { role } = useNovo();
  const pacotes = usePacotesDoPaciente(contactId);
  const [vendendo, setVendendo] = React.useState(false);
  const [ajuste, setAjuste] = React.useState<{
    tipo: AjusteDoPacote;
    pacote: PacoteDaFicha;
  } | null>(null);

  if (pacotes.error instanceof ApiError && [403, 409].includes(pacotes.error.status)) return null;
  const podeMudar = role !== "viewer";
  const gerencia = role === "manager" || role === "admin";
  const { vigentes, anteriores } = separarPacotes(pacotes.data ?? []);
  const ROTULO_DO_AJUSTE: Record<AjusteDoPacote, string> = {
    congelar: t("Congelar"),
    prorrogar: t("Prorrogar"),
    cancelar: t("Cancelar pacote"),
  };
  const botoes = (p: PacoteDaFicha) =>
    (podeMudar ? ajustesPermitidos(p, gerencia) : []).map((tipo) => (
      <button
        key={tipo}
        type="button"
        className={`n-botao n-botao-suave n-botao-pequeno ${tipo === "cancelar" ? "text-[var(--n-alerta)]" : ""}`}
        onClick={() => setAjuste({ tipo, pacote: p })}
      >
        {ROTULO_DO_AJUSTE[tipo]}
      </button>
    ));

  return (
    <section className="n-cartao p-5" data-testid="novo-pacotes">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">{t("Pacotes")}</h2>
        {podeMudar && (
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            onClick={() => setVendendo(true)}
            data-testid="novo-vender-pacote"
          >
            + {t("Vender pacote")}
          </button>
        )}
      </div>
      {vigentes.length === 0 ? (
        <p className="n-suave text-sm">
          {anteriores.length === 0
            ? t("Nenhum pacote vendido para este paciente.")
            : t("Nenhum pacote valendo agora.")}
        </p>
      ) : (
        <ul className="grid gap-5">
          {vigentes.map((p) => {
            const congelado = congeladoAte(p);
            return (
              <li key={p.id} data-testid="novo-pacote-valendo">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <PontoDaModalidade modalidade={p.modalidade} />
                    {p.nome}
                  </span>
                  <span className="n-numero text-sm font-semibold">
                    {p.sessoes_usadas}/{p.sessoes_total}
                  </span>
                </div>
                <div
                  className="mt-2 flex gap-1"
                  aria-label={`${p.sessoes_usadas} ${t("de")} ${p.sessoes_total}`}
                >
                  {Array.from({ length: p.sessoes_total }, (_, i) => (
                    <span
                      key={i}
                      className="h-2.5 flex-1 rounded-full"
                      style={{
                        background:
                          i < p.sessoes_usadas
                            ? `var(--agenda-modalidade-${p.modalidade})`
                            : "color-mix(in oklab, var(--n-tinta) 13%, transparent)",
                      }}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-sm font-semibold" data-testid="novo-saldo-do-pacote">
                  {t(
                    p.saldo === 1
                      ? "Resta {n} de {total} sessões"
                      : "Restam {n} de {total} sessões",
                  )
                    .replace("{n}", String(p.saldo))
                    .replace("{total}", String(p.sessoes_total))}
                </p>
                <p className="n-suave text-xs">
                  {t("Vale até {data}.").replace("{data}", dia(p.valido_ate))}
                  {congelado &&
                    ` ${(congelado.getTime() > pacotes.dataUpdatedAt
                      ? t("Congelado até {data}.")
                      : t("Ficou congelado até {data}.")
                    ).replace("{data}", dia(congelado.toISOString()))}`}
                  {p.valor_cents !== null &&
                    ` ${t("Pago {valor}.").replace("{valor}", formatCents(p.valor_cents, p.currency))}`}
                </p>
                {p.precisa_renovar && (
                  <p className="mt-1 text-xs font-bold text-[var(--n-aviso)]">
                    {t("Hora de oferecer a renovação")}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">{botoes(p)}</div>
              </li>
            );
          })}
        </ul>
      )}
      {anteriores.length > 0 && (
        <details className="mt-4 text-sm" data-testid="novo-pacotes-anteriores">
          <summary className="n-suave cursor-pointer font-semibold">
            {t(anteriores.length === 1 ? "{n} pacote anterior" : "{n} pacotes anteriores").replace(
              "{n}",
              String(anteriores.length),
            )}
          </summary>
          <ul className="mt-2 grid gap-3">
            {anteriores.map((p) => (
              <li key={p.id}>
                <span className="block font-semibold">{p.nome}</span>
                <span className="n-suave block text-xs">
                  {p.situacao === "cancelado" && p.cancelado_em
                    ? t("Cancelado em {data}.").replace("{data}", dia(p.cancelado_em, true))
                    : p.situacao === "esgotado"
                      ? t("Todas as {total} sessões usadas.").replace(
                          "{total}",
                          String(p.sessoes_total),
                        )
                      : t("Venceu em {data}, com {n} de {total} sessões usadas.")
                          .replace("{data}", dia(p.valido_ate, true))
                          .replace("{n}", String(p.sessoes_usadas))
                          .replace("{total}", String(p.sessoes_total))}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">{botoes(p)}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {vendendo && <FolhaVenderPacote contactId={contactId} aoFechar={() => setVendendo(false)} />}
      {ajuste && (
        <FolhaAjustarPacote
          tipo={ajuste.tipo}
          pacote={ajuste.pacote}
          aoFechar={() => setAjuste(null)}
        />
      )}
    </section>
  );
}

function useAtualizarPacotes() {
  const qc = useQueryClient();
  const recarregar = useRecarregar();
  return () => {
    void qc.invalidateQueries({ queryKey: ["clinica", "pacotes"] });
    recarregar();
  };
}

function rotuloDaOpcao(o: OpcaoDeVenda, t: (s: string) => string) {
  if (o.tipo === "produto") {
    return {
      nome: o.produto.nome,
      modalidade: o.produto.modalidade,
      detalhe: t(
        o.produto.sessoes === 1
          ? "{n} sessão, vale por {dias} dias"
          : "{n} sessões, vale por {dias} dias",
      )
        .replace("{n}", String(o.produto.sessoes))
        .replace("{dias}", String(o.produto.validade_dias)),
      valor:
        o.produto.valor_cents !== null
          ? formatCents(o.produto.valor_cents, o.produto.currency)
          : t("Sem preço definido"),
    };
  }
  return {
    nome: t("Pacote padrão de {modalidade}").replace(
      "{modalidade}",
      t(ROTULO_DA_MODALIDADE[o.modalidade]),
    ),
    modalidade: o.modalidade,
    detalhe: t("Sessões e validade das Regras da clínica"),
    valor: null,
  };
}

/** Montada a cada abertura: a chave de idempotência e o formulário nascem limpos. */
export function FolhaVenderPacote({
  contactId,
  modalidadeSugerida = null,
  aoFechar,
}: {
  contactId: string;
  modalidadeSugerida?: Modalidade | null;
  aoFechar: () => void;
}) {
  const t = useT();
  const { modalidades } = useNovo();
  const atualizar = useAtualizarPacotes();
  const politica = usePolitica();
  const catalogo = useQuery({
    queryKey: ["clinica", "produtos"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () =>
      (await apiClient.get<{ data: ProdutoDoCatalogo[] }>("/api/v1/clinica/produtos")).data,
  });
  const [chave] = React.useState(() => randomId());
  const [escolhaFeita, setEscolha] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState("");
  const [aceite, setAceite] = React.useState(false);

  // Quem atende vê primeiro as opções da própria área; a recepção e a gerência veem todas.
  const todas = catalogo.data ? opcoesDeVenda(catalogo.data) : null;
  const daArea = (o: OpcaoDeVenda) =>
    !modalidades ||
    modalidades.includes(o.tipo === "produto" ? o.produto.modalidade : o.modalidade);
  const opcoes = todas ? [...todas.filter(daArea), ...todas.filter((o) => !daArea(o))] : null;
  const escolha =
    escolhaFeita ??
    opcoes?.find(
      (o) =>
        modalidadeSugerida !== null &&
        (o.tipo === "produto" ? o.produto.modalidade : o.modalidade) === modalidadeSugerida,
    )?.chave ??
    null;
  const opcao = opcoes?.find((o) => o.chave === escolha) ?? null;
  const valorCents = opcao?.tipo === "padrao" ? parseReaisToCents(valor) : null;
  const valorInvalido = opcao?.tipo === "padrao" && valor.trim() !== "" && valorCents === null;
  const pronto = opcao !== null && aceite && politica.data !== undefined && !valorInvalido;

  const vender = useMutation({
    mutationFn: async () =>
      apiClient.post("/api/v1/clinica/pacotes", corpoDaVenda(contactId, opcao!, valorCents), {
        idempotencyKey: chave,
      }),
    onSuccess: () => {
      atualizar();
      toast.success(t("Pacote vendido."));
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={t("Vender pacote")}
      subtitulo={t(
        "Escolha o pacote e leia a política de cancelamento com o paciente antes de confirmar.",
      )}
      testid="novo-folha-vender-pacote"
    >
      <div className="grid gap-5">
        <div className="grid gap-2" role="radiogroup" aria-label={t("Pacote")}>
          {!opcoes ? (
            <p className="n-suave text-sm">{t("Carregando…")}</p>
          ) : (
            opcoes.map((o) => {
              const r = rotuloDaOpcao(o, t);
              const marcada = o.chave === escolha;
              return (
                <button
                  key={o.chave}
                  type="button"
                  role="radio"
                  aria-checked={marcada}
                  onClick={() => setEscolha(o.chave)}
                  className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left ${
                    marcada
                      ? "border-[var(--n-forte)] bg-[var(--n-cartao)]"
                      : "border-transparent bg-[var(--n-papel)]"
                  }`}
                >
                  <PontoDaModalidade modalidade={r.modalidade} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{r.nome}</span>
                    <span className="n-suave block text-xs">{r.detalhe}</span>
                  </span>
                  {r.valor && <span className="n-numero text-sm font-semibold">{r.valor}</span>}
                </button>
              );
            })
          )}
        </div>

        {opcao?.tipo === "padrao" && (
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Valor do pacote (opcional)")}</span>
            <input
              className="n-campo"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              aria-invalid={valorInvalido || undefined}
            />
            {valorInvalido && (
              <span className="text-xs font-semibold text-[var(--n-alerta)]">
                {t("Digite só números, como 450,00.")}
              </span>
            )}
          </label>
        )}

        <div className="grid gap-2 rounded-2xl bg-[var(--n-papel)] p-4 text-sm">
          <span className="font-bold">{t("Política de cancelamento")}</span>
          {politica.data ? (
            <ul className="n-suave grid list-disc gap-1 pl-5">
              <li>
                {t(
                  "Cancelar com menos de {horas} horas de antecedência gera multa de {pct}% do valor da sessão.",
                )
                  .replace("{horas}", String(politica.data.antecedencia_cancelamento_horas))
                  .replace("{pct}", String(politica.data.multa_cancelamento_pct))}
              </li>
              <li>
                {t("Atrasos de até {min} minutos são tolerados.").replace(
                  "{min}",
                  String(politica.data.tolerancia_atraso_minutos),
                )}
              </li>
              <li>{t("Falta sem aviso conta como sessão usada.")}</li>
            </ul>
          ) : politica.isError ? (
            <span className="text-[var(--n-alerta)]">
              {t("Não foi possível carregar a política agora. Feche e abra de novo.")}
            </span>
          ) : (
            <span className="n-suave">{t("Carregando…")}</span>
          )}
          <label className="mt-1 flex cursor-pointer items-start gap-2.5 font-semibold">
            <input
              type="checkbox"
              checked={aceite}
              onChange={(e) => setAceite(e.target.checked)}
              disabled={!politica.data}
              className="mt-0.5 h-4 w-4 accent-[var(--n-forte)]"
              data-testid="novo-aceite-da-politica"
            />
            {t("O paciente leu e aceitou a política de cancelamento.")}
          </label>
        </div>

        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={!pronto || vender.isPending}
          onClick={() => vender.mutate()}
          data-testid="novo-confirmar-venda"
        >
          {vender.isPending ? t("Vendendo…") : t("Confirmar venda")}
        </button>
      </div>
    </Folha>
  );
}

function FolhaAjustarPacote({
  tipo,
  pacote,
  aoFechar,
}: {
  tipo: AjusteDoPacote;
  pacote: PacoteDaFicha;
  aoFechar: () => void;
}) {
  const t = useT();
  const atualizar = useAtualizarPacotes();
  const [dias, setDias] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [reembolso, setReembolso] = React.useState("");

  const maximoDeDias = tipo === "congelar" ? 180 : 730;
  const diasNumero = Number(dias);
  const diasValidos = Number.isInteger(diasNumero) && diasNumero >= 1 && diasNumero <= maximoDeDias;
  const reembolsoCents = parseReaisToCents(reembolso);
  const reembolsoInvalido = reembolso.trim() !== "" && reembolsoCents === null;
  const pronto =
    motivo.trim().length >= 3 && (tipo === "cancelar" ? !reembolsoInvalido : diasValidos);

  const textos = {
    congelar: {
      titulo: t("Congelar pacote"),
      descricao: t(
        "A validade fica parada pelos dias do congelamento. Cada pacote pode ser congelado uma vez.",
      ),
      botao: t("Congelar"),
      feito: t("Pacote congelado."),
    },
    prorrogar: {
      titulo: t("Prorrogar pacote"),
      descricao: t("A validade ganha mais dias. Um pacote vencido volta a valer a partir de hoje."),
      botao: t("Prorrogar"),
      feito: t("Pacote prorrogado."),
    },
    cancelar: {
      titulo: t("Cancelar pacote"),
      descricao: t(
        "As sessões que restam deixam de valer. O pacote continua no histórico do paciente.",
      ),
      botao: t("Cancelar pacote"),
      feito: t("Pacote cancelado."),
    },
  }[tipo];

  const salvar = useMutation({
    mutationFn: async () =>
      apiClient.post(
        `/api/v1/clinica/pacotes/${encodeURIComponent(pacote.id)}/${tipo}`,
        tipo === "cancelar"
          ? {
              motivo: motivo.trim(),
              ...(reembolsoCents !== null ? { reembolso_cents: reembolsoCents } : {}),
            }
          : { dias: diasNumero, motivo: motivo.trim() },
      ),
    onSuccess: () => {
      atualizar();
      toast.success(textos.feito);
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={textos.titulo}
      subtitulo={`${pacote.nome}. ${textos.descricao}`}
      testid="novo-folha-ajustar-pacote"
    >
      <div className="grid gap-5">
        {tipo !== "cancelar" && (
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">
              {tipo === "congelar"
                ? t("Congelar por quantos dias")
                : t("Prorrogar por quantos dias")}
            </span>
            <input
              className="n-campo max-w-[10rem]"
              type="number"
              inputMode="numeric"
              min={1}
              max={maximoDeDias}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
            />
          </label>
        )}
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("Motivo")}</span>
          <textarea
            className="n-campo min-h-[84px] py-3"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={tipo === "congelar" ? t("Ex.: viagem de férias") : undefined}
          />
        </label>
        {tipo === "cancelar" && (
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Reembolso (opcional)")}</span>
            <input
              className="n-campo max-w-[12rem]"
              inputMode="decimal"
              placeholder="0,00"
              value={reembolso}
              onChange={(e) => setReembolso(e.target.value)}
              aria-invalid={reembolsoInvalido || undefined}
            />
            <span className="n-fraco text-xs">
              {t(
                "Em branco, o sistema calcula: as sessões que restam pelo preço avulso, sem passar do valor pago.",
              )}
            </span>
          </label>
        )}
        <button
          type="button"
          className={`n-botao w-full ${tipo === "cancelar" ? "n-botao-perigo" : "n-botao-principal"}`}
          disabled={!pronto || salvar.isPending}
          onClick={() => salvar.mutate()}
          data-testid="novo-salvar-ajuste"
        >
          {salvar.isPending ? t("Salvando…") : textos.botao}
        </button>
      </div>
    </Folha>
  );
}
