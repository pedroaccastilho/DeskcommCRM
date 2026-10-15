"use client";

/**
 * O PAINEL FINANCEIRO da interface nova (`/financeiro`): o que entrou, o que saiu e o que ainda
 * falta cobrar dos pacientes no período (migration 9012).
 *
 * Pedido do Pedro (2026-10-15): "Pra galera que tem acesso ao financeiro, eu preciso que eles
 * tenham acesso à um cockpit de entradas e saídas, pra eles saberem oq ainda precisa cobrar do
 * cliente, oq já entrou, etc…". Quem vê: Administrador, Gerente e Financeiro (a régua do
 * relatório da gestão). As somas são do banco; esta tela só desenha.
 *
 *  - "A cobrar": pacote, sessão avulsa e multa do período ainda sem pagamento, com o botão de
 *    registrar o pagamento ali mesmo (a mesma folha da ficha do paciente).
 *  - "Entradas": os pagamentos registrados no período.
 *  - "Saídas": as despesas lançadas à mão (aluguel, salário…), com "Registrar saída".
 *  - "Vai entrar": a previsão pela agenda ("E previsão doq vai entrar baseado nas agendas"), as
 *    sessões marcadas de hoje até o fim do período pelo preço de tabela; as que um pacote cobre
 *    aparecem marcadas e ficam fora da soma.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import {
  CATEGORIAS_DE_DESPESA,
  FORMAS_DE_SAIDA,
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_FORMA_DE_SAIDA,
  ROTULO_DO_TIPO,
  saldoDo,
  type CategoriaDeDespesa,
  type Despesa,
  type EntradaFinanceira,
  type FormaDeSaida,
  type ItemAReceber,
  type ItemPrevisto,
  type PainelFinanceiro,
  type TipoDeExportacaoFinanceira,
  type TipoDoItem,
} from "@/lib/clinica/financeiro";
import { veRelatoriosDaGestao } from "@/lib/clinica/gestao";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { formatCents, parseReaisToCents } from "@/lib/money";
import { DownloadSimple } from "@/lib/ui/icons";

import { useNovo } from "./Casca";
import { useRecarregar } from "./dados";
import { FolhaDePagamento, useRegistraPagamento, type AlvoDoPagamento } from "./Pagamentos";
import { Carregando, Folha, Secao, Vazio } from "./pecas";
import {
  SeletorDePeriodo,
  hojeNoFuso,
  periodoDoAtalho,
  type Atalho,
  type Periodo,
} from "./Relatorios";

type Aba = "a_receber" | "previsao" | "entradas" | "saidas";

const CHAVE = ["clinica", "financeiro"] as const;

function usePainel(de: string, ate: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE, de, ate],
    queryFn: async () =>
      (
        await apiClient.get<{ data: PainelFinanceiro }>(
          `/api/v1/clinica/financeiro?de=${de}&ate=${ate}`,
        )
      ).data,
    enabled: habilitado,
    placeholderData: (anterior) => anterior,
  });
}

/** "12 out": o dia e o mês curtos, no fuso da clínica. */
function diaCurto(iso: string, fuso: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: fuso })
    .format(new Date(iso))
    .replace(".", "");
}

const dinheiro = (centavos: number, moeda = "BRL") => formatCents(centavos, moeda);

export function TelaDoFinanceiro() {
  const t = useT();
  const { role, eu, fuso } = useNovo();
  const pode = veRelatoriosDaGestao(role, eu?.cargos ?? []);
  const hoje = hojeNoFuso(fuso);

  const [atalho, setAtalho] = React.useState<Atalho>("mes");
  const [livre, setLivre] = React.useState<Periodo>(() => periodoDoAtalho("mes", hoje));
  const periodo = atalho === "livre" ? livre : periodoDoAtalho(atalho, hoje);
  const valido = periodo.de <= periodo.ate;
  const [aba, setAba] = React.useState<Aba>("a_receber");

  const painel = usePainel(periodo.de, periodo.ate, pode && valido);

  if (!pode) {
    return (
      <div className="n-conteudo max-w-3xl" data-testid="novo-financeiro">
        <Vazio
          titulo={t("O financeiro é da gestão")}
          texto={t("Peça ao administrador o perfil de Gerente ou Financeiro.")}
        />
      </div>
    );
  }

  const p = painel.data;
  return (
    <div className="n-conteudo max-w-5xl" data-testid="novo-financeiro">
      <div className="n-entra">
        <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">{t("Financeiro")}</h1>
        <p className="n-suave mt-1">
          {t("O que entrou, o que saiu, o que falta cobrar e o que a agenda diz que vai entrar.")}
        </p>
      </div>

      <SeletorDePeriodo
        atalho={atalho}
        aoMudarAtalho={setAtalho}
        livre={livre}
        aoMudarLivre={setLivre}
        periodo={periodo}
      />

      {!valido ? (
        <div className="mt-6">
          <Vazio titulo={t("A data inicial vem antes da final.")} />
        </div>
      ) : painel.isLoading ? (
        <div className="mt-6">
          <Carregando linhas={4} />
        </div>
      ) : painel.error || !p ? (
        <div className="mt-6">
          <Vazio titulo={t("Não foi possível carregar o financeiro.")} />
        </div>
      ) : (
        <div className={`mt-6 grid gap-8 ${painel.isFetching ? "opacity-70" : ""}`}>
          <Totais p={p} aoAbrir={setAba} />

          <div>
            <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t("O que ver")}>
              <BotaoDaAba aba="a_receber" atual={aba} aoEscolher={setAba}>
                {t("A cobrar")} <span className="n-numero">{p.resumo.a_receber.qtd}</span>
              </BotaoDaAba>
              <BotaoDaAba aba="previsao" atual={aba} aoEscolher={setAba}>
                {t("Vai entrar")} <span className="n-numero">{p.resumo.previsao.qtd}</span>
              </BotaoDaAba>
              <BotaoDaAba aba="entradas" atual={aba} aoEscolher={setAba}>
                {t("Entradas")} <span className="n-numero">{p.resumo.entradas.qtd}</span>
              </BotaoDaAba>
              <BotaoDaAba aba="saidas" atual={aba} aoEscolher={setAba}>
                {t("Saídas")} <span className="n-numero">{p.resumo.saidas.qtd}</span>
              </BotaoDaAba>
            </div>
            {aba === "a_receber" && <ACobrar p={p} />}
            {aba === "previsao" && <Previsao p={p} />}
            {aba === "entradas" && <Entradas p={p} />}
            {aba === "saidas" && <Saidas p={p} />}
          </div>

          <Secao titulo={t("Planilhas do financeiro")}>
            <Exportar de={periodo.de} ate={periodo.ate} />
          </Secao>
        </div>
      )}
    </div>
  );
}

function BotaoDaAba({
  aba,
  atual,
  aoEscolher,
  children,
}: {
  aba: Aba;
  atual: Aba;
  aoEscolher: (a: Aba) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      className="n-chip"
      aria-selected={atual === aba}
      aria-pressed={atual === aba}
      onClick={() => aoEscolher(aba)}
      data-testid={`novo-financeiro-aba-${aba}`}
    >
      {children}
    </button>
  );
}

function Total({
  rotulo,
  valor,
  detalhe,
  tom,
  testid,
  aoClicar,
  largo,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "alerta" | "aviso" | "ok";
  testid: string;
  aoClicar?: () => void;
  /** No celular ocupa a linha toda (o quinto cartão não fica sozinho pela metade). */
  largo?: boolean;
}) {
  const cor =
    tom === "alerta"
      ? "text-[var(--n-alerta)]"
      : tom === "aviso"
        ? "text-[var(--n-aviso)]"
        : tom === "ok"
          ? "text-[var(--n-ok)]"
          : "";
  // Um bloco só: o botão clicável é flex, e o rótulo, o valor e o detalhe vão um embaixo do outro.
  const corpo = (
    <div className="w-full">
      <p className="n-suave text-[13px] font-semibold">{rotulo}</p>
      <p
        className={`n-titulo n-numero mt-1 text-[24px] leading-none sm:text-[28px] lg:text-[26px] ${cor}`}
      >
        {valor}
      </p>
      {detalhe && <p className="n-fraco mt-1.5 text-[13px]">{detalhe}</p>}
    </div>
  );
  return aoClicar ? (
    <button
      type="button"
      className="n-cartao n-entra n-linha-clicavel px-5 py-4 text-left"
      onClick={aoClicar}
      data-testid={testid}
    >
      {corpo}
    </button>
  ) : (
    <div
      className={`n-cartao n-entra px-5 py-4 ${largo ? "col-span-2 sm:col-span-1" : ""}`}
      data-testid={testid}
    >
      {corpo}
    </div>
  );
}

function quantos(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

function Totais({ p, aoAbrir }: { p: PainelFinanceiro; aoAbrir: (a: Aba) => void }) {
  const t = useT();
  const r = p.resumo;
  const saldo = saldoDo(r);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Total
        rotulo={t("A receber")}
        valor={dinheiro(r.a_receber.total_cents)}
        detalhe={quantos(r.a_receber.qtd, t("item em aberto"), t("itens em aberto"))}
        tom={r.a_receber.qtd > 0 ? "aviso" : undefined}
        testid="novo-financeiro-a-receber"
        aoClicar={() => aoAbrir("a_receber")}
      />
      <Total
        rotulo={t("Vai entrar")}
        valor={dinheiro(r.previsao.total_cents)}
        detalhe={quantos(r.previsao.qtd, t("sessão marcada"), t("sessões marcadas"))}
        testid="novo-financeiro-previsao"
        aoClicar={() => aoAbrir("previsao")}
      />
      <Total
        rotulo={t("Entrou")}
        valor={dinheiro(r.entradas.total_cents)}
        detalhe={quantos(r.entradas.qtd, t("pagamento"), t("pagamentos"))}
        tom="ok"
        testid="novo-financeiro-entrou"
        aoClicar={() => aoAbrir("entradas")}
      />
      <Total
        rotulo={t("Saiu")}
        valor={dinheiro(r.saidas.total_cents)}
        detalhe={quantos(r.saidas.qtd, t("despesa"), t("despesas"))}
        testid="novo-financeiro-saiu"
        aoClicar={() => aoAbrir("saidas")}
      />
      <Total
        rotulo={t("Saldo do período")}
        valor={dinheiro(saldo)}
        detalhe={t("Entrou menos saiu")}
        tom={saldo < 0 ? "alerta" : undefined}
        testid="novo-financeiro-saldo"
        largo
      />
    </div>
  );
}

/** As parcelas de um total, em selos ("Pacotes R$ 1.500 · 2"). */
function Parcelas({ itens }: { itens: { rotulo: string; qtd: number; valor_cents: number }[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {itens.map((i) => (
        <span key={i.rotulo} className="n-selo n-selo-neutro n-numero">
          {i.rotulo} · {dinheiro(i.valor_cents)} · {i.qtd}
        </span>
      ))}
    </div>
  );
}

function Cortado({ mostrar }: { mostrar: boolean }) {
  const t = useT();
  if (!mostrar) return null;
  return (
    <p className="n-fraco mt-2 text-[13px]">
      {t("A lista mostra os primeiros 500. A planilha traz todos.")}
    </p>
  );
}

function NomeDoPaciente({ l }: { l: EntradaFinanceira | ItemAReceber | ItemPrevisto }) {
  const t = useT();
  const nome = rotuloDoContato(
    { name: l.contato_name, display_name: l.contato_display_name, phone_number: l.contato_phone },
    t,
  );
  return l.contact_id ? (
    <Link href={`/pacientes/${l.contact_id}`} className="font-semibold hover:underline">
      {nome}
    </Link>
  ) : (
    <span className="font-semibold">{nome}</span>
  );
}

function alvoDo(item: ItemAReceber): AlvoDoPagamento {
  if (item.tipo === "pacote") return { pacote_id: item.id };
  if (item.tipo === "sessao") return { appointment_id: item.id };
  return { multa_id: item.id };
}

const ROTULO_DO_ITEM: Record<TipoDoItem, string> = {
  pacote: "Pacote",
  sessao: "Sessão avulsa",
  multa: "Multa",
};

/** "Pacote · Pilates 10 sessões", "Sessão avulsa · Fisioterapia", "Multa por falta". */
function oQueE(tipo: TipoDoItem, descricao: string | null, t: (s: string) => string): string {
  // A descrição da multa vem do banco como frase fixa ("Multa por falta"), e por isso traduz.
  if (tipo === "multa") return t(descricao ?? ROTULO_DO_ITEM.multa);
  return descricao ? `${t(ROTULO_DO_ITEM[tipo])} · ${descricao}` : t(ROTULO_DO_ITEM[tipo]);
}

function ACobrar({ p }: { p: PainelFinanceiro }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso } = useNovo();
  const registra = useRegistraPagamento();
  const [cobrando, setCobrando] = React.useState<ItemAReceber | null>(null);
  const r = p.resumo.a_receber;

  if (p.a_receber.length === 0) {
    return (
      <Vazio
        titulo={t("Nada a cobrar no período.")}
        texto={t("Pacotes, sessões avulsas e multas do período já estão pagos.")}
      />
    );
  }
  return (
    <div data-testid="novo-financeiro-lista-a-receber">
      <Parcelas itens={r.por_tipo.map((x) => ({ ...x, rotulo: t(ROTULO_DO_TIPO[x.tipo]) }))} />
      <ul className="n-cartao divide-y divide-[var(--n-linha)] px-5">
        {p.a_receber.map((item) => (
          <li
            key={`${item.tipo}-${item.id}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5"
            data-testid="novo-financeiro-item-a-receber"
          >
            <div className="min-w-0">
              <NomeDoPaciente l={item} />
              <p className="n-fraco text-[13px]">
                {oQueE(item.tipo, item.descricao, t)} · {t("desde")}{" "}
                {diaCurto(item.desde, fuso, tag)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="n-numero font-semibold">
                {item.valor_cents === null
                  ? t("Sem preço")
                  : dinheiro(item.valor_cents, item.currency)}
              </span>
              {registra && (
                <button
                  type="button"
                  className="n-botao n-botao-suave n-botao-pequeno"
                  onClick={() => setCobrando(item)}
                  data-testid="novo-financeiro-registrar-pagamento"
                >
                  {t("Registrar pagamento")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {r.sem_valor > 0 && (
        <p className="n-fraco mt-2 text-[13px]">
          {r.sem_valor} {t("item(ns) sem preço cadastrado não entram na soma.")}
        </p>
      )}
      <Cortado mostrar={p.cortado.a_receber} />
      {cobrando && (
        <FolhaDePagamento
          alvo={alvoDo(cobrando)}
          valorCents={cobrando.valor_cents}
          moeda={cobrando.currency}
          descricao={`${rotuloDoContato(
            {
              name: cobrando.contato_name,
              display_name: cobrando.contato_display_name,
              phone_number: cobrando.contato_phone,
            },
            t,
          )} · ${oQueE(cobrando.tipo, cobrando.descricao, t)}`}
          aoFechar={() => setCobrando(null)}
        />
      )}
    </div>
  );
}

function Previsao({ p }: { p: PainelFinanceiro }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso } = useNovo();
  const r = p.resumo.previsao;
  if (p.previsao.length === 0) {
    return (
      <Vazio
        titulo={t("Nenhuma sessão marcada daqui até o fim do período.")}
        texto={t("A previsão soma as sessões da agenda que ainda vão acontecer.")}
      />
    );
  }
  return (
    <div data-testid="novo-financeiro-lista-previsao">
      <p className="n-suave mb-3 text-sm">
        {t("Sessões marcadas de hoje até o fim do período, pelo preço de tabela.")}{" "}
        {r.cobertas_por_pacote > 0 &&
          quantos(
            r.cobertas_por_pacote,
            t("sessão coberta por pacote fica fora da soma."),
            t("sessões cobertas por pacote ficam fora da soma."),
          )}
      </p>
      <ul className="n-cartao divide-y divide-[var(--n-linha)] px-5">
        {p.previsao.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3.5"
            data-testid="novo-financeiro-item-previsto"
          >
            <div className="min-w-0">
              <NomeDoPaciente l={item} />
              <p className="n-fraco text-[13px]">
                {item.descricao ?? t("Sessão")} · {diaCurto(item.starts_at, fuso, tag)}
              </p>
            </div>
            {item.coberta_por_pacote ? (
              <span className="n-selo n-selo-neutro">{t("Pacote")}</span>
            ) : (
              <span className="n-numero font-semibold">
                {item.valor_cents === null
                  ? t("Sem preço")
                  : dinheiro(item.valor_cents, item.currency)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {r.sem_valor > 0 && (
        <p className="n-fraco mt-2 text-[13px]">
          {r.sem_valor} {t("item(ns) sem preço cadastrado não entram na soma.")}
        </p>
      )}
      <Cortado mostrar={p.cortado.previsao} />
    </div>
  );
}

function Entradas({ p }: { p: PainelFinanceiro }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso } = useNovo();
  const r = p.resumo.entradas;
  if (p.entradas.length === 0) {
    return (
      <Vazio
        titulo={t("Nenhum pagamento no período.")}
        texto={t("Os pagamentos registrados na ficha e na sessão aparecem aqui.")}
      />
    );
  }
  return (
    <div data-testid="novo-financeiro-lista-entradas">
      <Parcelas
        itens={r.por_forma.map((x) => ({
          ...x,
          rotulo: t(ROTULO_DA_FORMA_DE_SAIDA[x.forma]),
        }))}
      />
      <ul className="n-cartao divide-y divide-[var(--n-linha)] px-5">
        {p.entradas.map((e) => (
          <li
            key={e.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3.5"
            data-testid="novo-financeiro-entrada"
          >
            <div className="min-w-0">
              <NomeDoPaciente l={e} />
              <p className="n-fraco text-[13px]">
                {oQueE(e.tipo, e.descricao, t)} · {t(ROTULO_DA_FORMA_DE_SAIDA[e.forma])} ·{" "}
                {diaCurto(e.pago_em, fuso, tag)}
              </p>
            </div>
            <span className="n-numero font-semibold">
              {e.valor_cents === null ? "—" : dinheiro(e.valor_cents, e.currency)}
            </span>
          </li>
        ))}
      </ul>
      <Cortado mostrar={p.cortado.entradas} />
    </div>
  );
}

function Saidas({ p }: { p: PainelFinanceiro }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso, soOlhar } = useNovo();
  const [registrando, setRegistrando] = React.useState(false);
  const r = p.resumo.saidas;
  const recarregar = useRecarregar();
  const apagar = useMutation({
    mutationFn: async (id: string) =>
      apiClient.delete(`/api/v1/clinica/despesas/${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(t("Saída apagada."));
      recarregar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <div data-testid="novo-financeiro-lista-saidas">
      {!soOlhar && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className="n-botao n-botao-principal"
            onClick={() => setRegistrando(true)}
            data-testid="novo-financeiro-registrar-saida"
          >
            {t("Registrar saída")}
          </button>
        </div>
      )}
      {p.saidas.length === 0 ? (
        <Vazio
          titulo={t("Nenhuma saída no período.")}
          texto={t("Lance aqui o aluguel, os salários, os materiais e as outras contas pagas.")}
        />
      ) : (
        <>
          <Parcelas
            itens={r.por_categoria.map((x) => ({
              ...x,
              rotulo: t(ROTULO_DA_CATEGORIA[x.categoria]),
            }))}
          />
          <ul className="n-cartao divide-y divide-[var(--n-linha)] px-5">
            {p.saidas.map((d: Despesa) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3.5"
                data-testid="novo-financeiro-saida"
              >
                <div className="min-w-0">
                  <p className="font-semibold">{d.descricao}</p>
                  <p className="n-fraco text-[13px]">
                    {t(ROTULO_DA_CATEGORIA[d.categoria])} · {t(ROTULO_DA_FORMA_DE_SAIDA[d.forma])} ·{" "}
                    {diaCurto(d.pago_em, fuso, tag)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="n-numero font-semibold">
                    {dinheiro(d.valor_cents, d.currency)}
                  </span>
                  {!soOlhar && (
                    <button
                      type="button"
                      className="n-botao n-botao-suave n-botao-pequeno"
                      disabled={apagar.isPending}
                      onClick={() => {
                        if (window.confirm(t("Apagar esta saída?"))) apagar.mutate(d.id);
                      }}
                      data-testid="novo-financeiro-apagar-saida"
                    >
                      {t("Apagar")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Cortado mostrar={p.cortado.saidas} />
        </>
      )}
      {registrando && <FolhaDeSaida aoFechar={() => setRegistrando(false)} />}
    </div>
  );
}

/** Montada a cada abertura: tudo nasce em branco, menos o dia (hoje). */
function FolhaDeSaida({ aoFechar }: { aoFechar: () => void }) {
  const t = useT();
  const { fuso } = useNovo();
  const recarregar = useRecarregar();
  const [descricao, setDescricao] = React.useState("");
  const [categoria, setCategoria] = React.useState<CategoriaDeDespesa | "">("");
  const [forma, setForma] = React.useState<FormaDeSaida | null>(null);
  const [valor, setValor] = React.useState("");
  const [dia, setDia] = React.useState(() => hojeNoFuso(fuso));
  const valorCents = parseReaisToCents(valor);
  const valorInvalido = valor.trim() !== "" && (valorCents === null || valorCents <= 0);
  const pronto =
    descricao.trim().length >= 2 &&
    categoria !== "" &&
    forma !== null &&
    valorCents !== null &&
    valorCents > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(dia);

  const registrar = useMutation({
    mutationFn: async () =>
      apiClient.post("/api/v1/clinica/despesas", {
        descricao: descricao.trim(),
        categoria,
        forma,
        valor_cents: valorCents,
        dia,
      }),
    onSuccess: () => {
      toast.success(t("Saída registrada."));
      recarregar();
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={t("Registrar saída")}
      subtitulo={t("Uma conta que a clínica já pagou.")}
      testid="novo-folha-saida"
    >
      <div className="grid gap-5">
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("O que foi pago")}</span>
          <input
            className="n-campo"
            value={descricao}
            maxLength={160}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder={t("Ex.: aluguel de outubro")}
            data-testid="novo-saida-descricao"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("Categoria")}</span>
          <select
            className="n-campo"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value as CategoriaDeDespesa | "")}
            data-testid="novo-saida-categoria"
          >
            <option value="">{t("Escolha")}</option>
            {CATEGORIAS_DE_DESPESA.map((c) => (
              <option key={c} value={c}>
                {t(ROTULO_DA_CATEGORIA[c])}
              </option>
            ))}
          </select>
        </label>
        <div>
          <p className="n-rotulo">{t("Como foi pago?")}</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("Forma de pagamento")}>
            {FORMAS_DE_SAIDA.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={forma === f}
                onClick={() => setForma(f)}
                className={`n-botao ${forma === f ? "n-botao-escuro" : "n-botao-suave"}`}
                data-testid={`novo-saida-forma-${f}`}
              >
                {t(ROTULO_DA_FORMA_DE_SAIDA[f])}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Valor")}</span>
            <input
              className="n-campo"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="0,00"
              data-testid="novo-saida-valor"
            />
            {valorInvalido && (
              <span className="text-xs text-[var(--n-alerta)]">{t("Valor inválido.")}</span>
            )}
          </label>
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Pago em")}</span>
            <input
              type="date"
              className="n-campo"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              data-testid="novo-saida-dia"
            />
          </label>
        </div>
        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={!pronto || registrar.isPending}
          onClick={() => registrar.mutate()}
          data-testid="novo-confirmar-saida"
        >
          {registrar.isPending ? t("Salvando…") : t("Registrar saída")}
        </button>
      </div>
    </Folha>
  );
}

function Exportar({ de, ate }: { de: string; ate: string }) {
  const t = useT();
  const href = (tipo: TipoDeExportacaoFinanceira) =>
    `/api/v1/clinica/financeiro/exportar?tipo=${tipo}&de=${de}&ate=${ate}`;
  return (
    <div className="n-cartao px-5 py-4" data-testid="novo-financeiro-exportar">
      <p className="n-suave text-sm">
        {t(
          "Planilhas do período escolhido, no padrão brasileiro (ponto e vírgula, vírgula nos centavos). Abrem direto no Excel.",
        )}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="n-botao n-botao-principal"
          href={href("a_receber")}
          download
          data-testid="novo-financeiro-exportar-a-receber"
        >
          <DownloadSimple size={18} />
          {t("A cobrar")}
        </a>
        <a
          className="n-botao n-botao-suave"
          href={href("previsao")}
          download
          data-testid="novo-financeiro-exportar-previsao"
        >
          <DownloadSimple size={18} />
          {t("Vai entrar")}
        </a>
        <a
          className="n-botao n-botao-suave"
          href={href("entradas")}
          download
          data-testid="novo-financeiro-exportar-entradas"
        >
          <DownloadSimple size={18} />
          {t("Entradas")}
        </a>
        <a
          className="n-botao n-botao-suave"
          href={href("saidas")}
          download
          data-testid="novo-financeiro-exportar-saidas"
        >
          <DownloadSimple size={18} />
          {t("Saídas")}
        </a>
      </div>
    </div>
  );
}
