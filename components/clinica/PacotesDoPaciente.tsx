"use client";

/**
 * Os pacotes de sessões na ficha do paciente — o lado de TELA das rotas de pacotes (migration
 * 9004) e de `lib/clinica/pacotes-na-ficha.ts`.
 *
 * Mostra o saldo do que está valendo ("Restam 6 de 10 sessões"), a validade, o congelamento e o
 * aviso de renovação; vende um pacote com o aceite da política de cancelamento; e faz os ajustes
 * que cabem a cada perfil (congelar é da recepção, prorrogar e cancelar são da gerência). O
 * "Sessão 6 de 10" de quem está em tratamento é do plano de tratamento, e não se repete aqui.
 *
 * Só aparece com o módulo clínica e de Recepção para cima: o valor é financeiro, e a rota
 * responde 403 a "Somente leitura".
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  ajustesPermitidos,
  congeladoAte,
  corpoDaVenda,
  opcoesDeVenda,
  pacoteDaSessao,
  separarPacotes,
  type AjusteDoPacote,
  type OpcaoDeVenda,
  type PacoteDaFicha,
  type ProdutoDoCatalogo,
} from "@/lib/clinica/pacotes-na-ficha";
import { ROTULO_DA_MODALIDADE, type Modalidade } from "@/lib/clinica/vocabulario";
import { formatCents, parseReaisToCents } from "@/lib/money";
import { randomId } from "@/lib/random-id";
import { cn } from "@/lib/utils";

type Politica = {
  antecedencia_cancelamento_horas: number;
  multa_cancelamento_pct: number;
  tolerancia_atraso_minutos: number;
};

const chaveDosPacotes = (contactId: string) => ["clinica", "pacotes", contactId] as const;

function mensagemDoErro(e: unknown, t: (s: string) => string): string {
  return e instanceof ApiError && e.message
    ? e.message
    : t("Não foi possível salvar. Tente de novo.");
}

function usePacotes(contactId: string, habilitado: boolean) {
  return useQuery({
    queryKey: chaveDosPacotes(contactId),
    enabled: habilitado,
    staleTime: 30_000,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<{ data: PacoteDaFicha[] }>(
          `/api/v1/clinica/pacotes?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
  });
}

/**
 * A política vem da grade da agenda, que todo perfil lê: a rota das Regras da clínica é só do
 * administrador. Uma janela de um minuto basta, porque só o `politica` interessa.
 */
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

export function PacotesDoPaciente({
  contactId,
  ativo,
  gerencia,
  podeMudar,
}: {
  contactId: string;
  /** Módulo clínica instalado, Recepção para cima e paciente não anonimizado. */
  ativo: boolean;
  /** Gerente ou Administrador: prorroga e cancela. */
  gerencia: boolean;
  /** Falso no acompanhamento de suporte só de leitura. */
  podeMudar: boolean;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const pacotes = usePacotes(contactId, ativo);
  const [vendendo, setVendendo] = React.useState(false);
  const [ajuste, setAjuste] = React.useState<{
    tipo: AjusteDoPacote;
    pacote: PacoteDaFicha;
  } | null>(null);

  if (!ativo || !pacotes.data) return null;

  const { vigentes, anteriores } = separarPacotes(pacotes.data);
  const dia = (iso: string) => format(new Date(iso), t("d 'de' MMMM"), { locale: localeDaData });
  const diaComAno = (iso: string) =>
    format(new Date(iso), t("d 'de' MMMM 'de' yyyy"), { locale: localeDaData });
  const ROTULO_DO_AJUSTE: Record<AjusteDoPacote, string> = {
    congelar: t("Congelar"),
    prorrogar: t("Prorrogar"),
    cancelar: t("Cancelar pacote"),
  };

  return (
    <section
      data-testid="pacotes-do-paciente"
      aria-labelledby="titulo-pacotes"
      className="grid gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titulo-pacotes" className="text-base font-medium text-text">
          {t("Pacotes")}
        </h2>
        {podeMudar && (
          <Button variant="outline" size="sm" onClick={() => setVendendo(true)}>
            {t("Vender pacote")}
          </Button>
        )}
      </div>

      {vigentes.length === 0 ? (
        <p data-testid="sem-pacote-valendo" className="text-sm text-text-muted">
          {anteriores.length === 0
            ? t("Nenhum pacote vendido para este paciente.")
            : t("Nenhum pacote valendo agora.")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {vigentes.map((p) => {
            const congelado = congeladoAte(p);
            const ajustes = podeMudar ? ajustesPermitidos(p, gerencia) : [];
            return (
              <li
                key={p.id}
                data-testid="pacote-valendo"
                className="grid content-start gap-1 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-text-muted">{p.nome}</span>
                  {p.precisa_renovar && (
                    <Badge
                      variant="warning"
                      data-testid="hora-de-renovar"
                      className="shrink-0 whitespace-nowrap"
                    >
                      {t("Hora de renovar")}
                    </Badge>
                  )}
                </div>
                <span data-testid="saldo-do-pacote" className="text-lg font-semibold text-text">
                  {t(
                    p.saldo === 1
                      ? "Resta {n} de {total} sessões"
                      : "Restam {n} de {total} sessões",
                  )
                    .replace("{n}", String(p.saldo))
                    .replace("{total}", String(p.sessoes_total))}
                </span>
                <span className="text-sm text-text-muted">
                  {t("Vale até {data}.").replace("{data}", dia(p.valido_ate))}
                  {congelado && (
                    <>
                      {" "}
                      <span data-testid="pacote-congelado">
                        {(congelado.getTime() > pacotes.dataUpdatedAt
                          ? t("Congelado até {data}.")
                          : t("Ficou congelado até {data}.")
                        ).replace("{data}", dia(congelado.toISOString()))}
                      </span>
                    </>
                  )}
                  {p.valor_cents !== null && (
                    <>
                      {" "}
                      {t("Pago {valor}.").replace(
                        "{valor}",
                        formatCents(p.valor_cents, p.currency),
                      )}
                    </>
                  )}
                </span>
                {ajustes.length > 0 && (
                  <div className="mt-1 -ml-3 flex flex-wrap gap-1">
                    {ajustes.map((tipo) => (
                      <Button
                        key={tipo}
                        variant="ghost"
                        size="sm"
                        className={cn(tipo === "cancelar" && "text-error-fg")}
                        onClick={() => setAjuste({ tipo, pacote: p })}
                      >
                        {ROTULO_DO_AJUSTE[tipo]}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {anteriores.length > 0 && (
        <details data-testid="pacotes-anteriores" className="group text-sm">
          <summary className="cursor-pointer text-text-muted hover:text-text">
            {t(anteriores.length === 1 ? "{n} pacote anterior" : "{n} pacotes anteriores").replace(
              "{n}",
              String(anteriores.length),
            )}
          </summary>
          <ul className="mt-2 grid gap-2">
            {anteriores.map((p) => {
              const ajustes = podeMudar ? ajustesPermitidos(p, gerencia) : [];
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md border border-border px-3 py-2"
                >
                  <span className="grid">
                    <span className="text-text">{p.nome}</span>
                    <span className="text-text-muted">
                      {p.situacao === "cancelado" && p.cancelado_em
                        ? t("Cancelado em {data}.").replace("{data}", diaComAno(p.cancelado_em))
                        : p.situacao === "esgotado"
                          ? t("Todas as {total} sessões usadas.").replace(
                              "{total}",
                              String(p.sessoes_total),
                            )
                          : t("Venceu em {data}, com {n} de {total} sessões usadas.")
                              .replace("{data}", diaComAno(p.valido_ate))
                              .replace("{n}", String(p.sessoes_usadas))
                              .replace("{total}", String(p.sessoes_total))}
                    </span>
                  </span>
                  {ajustes.length > 0 && (
                    <span className="flex gap-1">
                      {ajustes.map((tipo) => (
                        <Button
                          key={tipo}
                          variant="ghost"
                          size="sm"
                          className={cn(tipo === "cancelar" && "text-error-fg")}
                          onClick={() => setAjuste({ tipo, pacote: p })}
                        >
                          {ROTULO_DO_AJUSTE[tipo]}
                        </Button>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {vendendo && <VenderPacote contactId={contactId} aoFechar={() => setVendendo(false)} />}
      {ajuste && (
        <AjustarPacote tipo={ajuste.tipo} pacote={ajuste.pacote} aoFechar={() => setAjuste(null)} />
      )}
    </section>
  );
}

function useAtualizarPacotes(contactId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: chaveDosPacotes(contactId) });
    void qc.invalidateQueries({ queryKey: ["clinica", "pacotes", "renovar"] });
  };
}

function rotuloDaOpcao(o: OpcaoDeVenda, t: (s: string) => string) {
  if (o.tipo === "produto") {
    return {
      nome: o.produto.nome,
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
    detalhe: t("Sessões e validade das Regras da clínica"),
    valor: null,
  };
}

/** Montado a cada abertura: a chave de idempotência e o formulário nascem limpos. */
export function VenderPacote({
  contactId,
  modalidadeSugerida = null,
  aoFechar,
}: {
  contactId: string;
  /** Vindo de uma sessão: a primeira opção dessa modalidade já abre escolhida. */
  modalidadeSugerida?: Modalidade | null;
  aoFechar: () => void;
}) {
  const t = useT();
  const atualizar = useAtualizarPacotes(contactId);
  const politica = usePolitica();
  const catalogo = useQuery({
    queryKey: ["clinica", "produtos"],
    staleTime: 60_000,
    retry: false,
    queryFn: async () =>
      (await apiClient.get<{ data: ProdutoDoCatalogo[] }>("/api/v1/clinica/produtos")).data,
  });
  const [chaveDeIdempotencia] = React.useState(() => randomId());
  const [escolhaFeita, setEscolha] = React.useState<string | null>(null);
  const [valor, setValor] = React.useState("");
  const [aceite, setAceite] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const opcoes = catalogo.data ? opcoesDeVenda(catalogo.data) : null;
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

  async function vender() {
    if (!opcao || !pronto) return;
    setEnviando(true);
    setErro(null);
    try {
      await apiClient.post("/api/v1/clinica/pacotes", corpoDaVenda(contactId, opcao, valorCents), {
        idempotencyKey: chaveDeIdempotencia,
      });
      atualizar();
      toast.success(t("Pacote vendido."));
      aoFechar();
    } catch (e) {
      setErro(mensagemDoErro(e, t));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Vender pacote")}</DialogTitle>
          <DialogDescription>
            {t(
              "Escolha o pacote e leia a política de cancelamento com o paciente antes de confirmar.",
            )}
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-2" data-testid="opcoes-de-pacote">
          <legend className="mb-2 text-sm font-medium text-text">{t("Pacote")}</legend>
          {!opcoes ? (
            <p className="text-sm text-text-muted">{t("Carregando…")}</p>
          ) : (
            opcoes.map((o) => {
              const r = rotuloDaOpcao(o, t);
              return (
                <label
                  key={o.chave}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm",
                    escolha === o.chave && "border-accent bg-accent-soft",
                  )}
                >
                  <input
                    type="radio"
                    name="pacote-a-vender"
                    value={o.chave}
                    checked={escolha === o.chave}
                    onChange={() => setEscolha(o.chave)}
                    className="accent-accent"
                  />
                  <span className="grid flex-1">
                    <span className="text-text">{r.nome}</span>
                    <span className="text-text-muted">{r.detalhe}</span>
                  </span>
                  {r.valor && <span className="text-text-muted">{r.valor}</span>}
                </label>
              );
            })
          )}
        </fieldset>

        {opcao?.tipo === "padrao" && (
          <div className="grid gap-1.5">
            <Label htmlFor="valor-do-pacote">{t("Valor do pacote (opcional)")}</Label>
            <Input
              id="valor-do-pacote"
              inputMode="decimal"
              placeholder="0,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              aria-invalid={valorInvalido || undefined}
            />
            {valorInvalido && (
              <span className="text-sm text-error-fg">{t("Digite só números, como 450,00.")}</span>
            )}
          </div>
        )}

        <div
          data-testid="politica-do-pacote"
          className="grid gap-2 rounded-md border border-border bg-surface-elevated p-3 text-sm"
        >
          <span className="font-medium text-text">{t("Política de cancelamento")}</span>
          {politica.data ? (
            <ul className="grid gap-1 text-text-muted">
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
            <span className="text-error-fg">
              {t("Não foi possível carregar a política agora. Feche e abra de novo.")}
            </span>
          ) : (
            <span className="text-text-muted">{t("Carregando…")}</span>
          )}
          <label className="mt-1 flex cursor-pointer items-start gap-2 text-text">
            <input
              type="checkbox"
              data-testid="aceite-da-politica"
              checked={aceite}
              onChange={(e) => setAceite(e.target.checked)}
              disabled={!politica.data}
              className="mt-0.5 accent-accent"
            />
            {t("O paciente leu e aceitou a política de cancelamento.")}
          </label>
        </div>

        {erro && (
          <p role="alert" className="text-sm text-error-fg">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("Voltar")}
          </Button>
          <Button onClick={vender} disabled={!pronto || enviando}>
            {enviando ? t("Vendendo…") : t("Confirmar venda")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AjustarPacote({
  tipo,
  pacote,
  aoFechar,
}: {
  tipo: AjusteDoPacote;
  pacote: PacoteDaFicha;
  aoFechar: () => void;
}) {
  const t = useT();
  const atualizar = useAtualizarPacotes(pacote.contact_id);
  const [dias, setDias] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [reembolso, setReembolso] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

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

  async function salvar() {
    if (!pronto) return;
    setEnviando(true);
    setErro(null);
    const corpo =
      tipo === "cancelar"
        ? {
            motivo: motivo.trim(),
            ...(reembolsoCents !== null ? { reembolso_cents: reembolsoCents } : {}),
          }
        : { dias: diasNumero, motivo: motivo.trim() };
    try {
      await apiClient.post(`/api/v1/clinica/pacotes/${pacote.id}/${tipo}`, corpo);
      atualizar();
      toast.success(textos.feito);
      aoFechar();
    } catch (e) {
      setErro(mensagemDoErro(e, t));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && aoFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{textos.titulo}</DialogTitle>
          <DialogDescription>
            {pacote.nome}. {textos.descricao}
          </DialogDescription>
        </DialogHeader>

        {tipo !== "cancelar" && (
          <div className="grid gap-1.5">
            <Label htmlFor="dias-do-ajuste">
              {tipo === "congelar"
                ? t("Congelar por quantos dias")
                : t("Prorrogar por quantos dias")}
            </Label>
            <Input
              id="dias-do-ajuste"
              type="number"
              inputMode="numeric"
              min={1}
              max={maximoDeDias}
              value={dias}
              onChange={(e) => setDias(e.target.value)}
              className="w-32"
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="motivo-do-ajuste">{t("Motivo")}</Label>
          <Textarea
            id="motivo-do-ajuste"
            rows={2}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={tipo === "congelar" ? t("Ex.: viagem de férias") : undefined}
          />
        </div>

        {tipo === "cancelar" && (
          <div className="grid gap-1.5">
            <Label htmlFor="reembolso-do-pacote">{t("Reembolso (opcional)")}</Label>
            <Input
              id="reembolso-do-pacote"
              inputMode="decimal"
              placeholder="0,00"
              value={reembolso}
              onChange={(e) => setReembolso(e.target.value)}
              aria-invalid={reembolsoInvalido || undefined}
              className="w-40"
            />
            <span className="text-sm text-text-muted">
              {t(
                "Em branco, o sistema calcula: as sessões que restam pelo preço avulso, sem passar do valor pago.",
              )}
            </span>
          </div>
        )}

        {erro && (
          <p role="alert" className="text-sm text-error-fg">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            {t("Voltar")}
          </Button>
          <Button
            variant={tipo === "cancelar" ? "destructive" : "primary"}
            onClick={salvar}
            disabled={!pronto || enviando}
          >
            {enviando ? t("Salvando…") : textos.botao}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O pacote no atendimento: uma linha com o que a sessão vai gastar ("Restam 4 de 10 sessões") ou
 * o aviso de que ela é avulsa, e o atalho para vender ou renovar sem sair da tela. Some para quem
 * não vê valor (Somente leitura recebe 403 da rota).
 */
export function PacoteDaSessao({
  contactId,
  modalidade,
  podeVender,
}: {
  contactId: string;
  modalidade: Modalidade | null;
  podeVender: boolean;
}) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const pacotes = usePacotes(contactId, Boolean(modalidade));
  const [vendendo, setVendendo] = React.useState(false);
  if (!modalidade || !pacotes.data) return null;

  const p = pacoteDaSessao(pacotes.data, modalidade);
  const dia = (iso: string) => format(new Date(iso), t("d 'de' MMMM"), { locale: localeDaData });
  const oferecer = podeVender && (!p || p.precisa_renovar);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
      data-testid="pacote-da-sessao"
    >
      {p ? (
        <span>
          <span className="font-medium">
            {t(p.saldo === 1 ? "Resta {n} de {total} sessões" : "Restam {n} de {total} sessões")
              .replace("{n}", String(p.saldo))
              .replace("{total}", String(p.sessoes_total))}
          </span>{" "}
          <span className="text-text-muted">
            {t("no pacote. Vale até {data}.").replace("{data}", dia(p.valido_ate))}
          </span>
        </span>
      ) : (
        <span className="text-text-muted">{t("Sessão avulsa, sem pacote valendo.")}</span>
      )}
      {p?.precisa_renovar ? (
        <Badge variant="warning" className="whitespace-nowrap">
          {t("Hora de renovar")}
        </Badge>
      ) : null}
      {oferecer ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setVendendo(true)}
          data-testid="vender-pacote-da-sessao"
        >
          {p ? t("Renovar pacote") : t("Vender pacote")}
        </Button>
      ) : null}
      {vendendo ? (
        <VenderPacote
          contactId={contactId}
          modalidadeSugerida={modalidade}
          aoFechar={() => setVendendo(false)}
        />
      ) : null}
    </div>
  );
}
