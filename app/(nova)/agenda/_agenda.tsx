"use client";

/**
 * AGENDA da interface nova, nas três visões da versão atual: Dia (uma coluna por profissional),
 * Semana (uma coluna por dia) e Mês (o calendário), com blocos na cor da modalidade. Quem atende
 * abre na própria agenda e pode ver a agenda da clínica inteira, só para olhar (pedido do Pedro em
 * 2026-10-09: a agenda é de cada um, mas todos veem a de todos); recepção e gestão veem todos. As contas das visões estão em `lib/novo/agenda.ts`.
 */
import * as React from "react";

import { diaLocalISO } from "@/lib/agenda/fuso";
import { POLITICA_PADRAO, type SessaoDaGrade } from "@/lib/clinica/agenda";
import {
  VISOES_DA_AGENDA,
  andar,
  diaDaSemana,
  diasDaVisao,
  faixasLadoALado,
  type VisaoDaAgenda,
} from "@/lib/novo/agenda";
import { janelaDoDia } from "@/lib/novo/hoje";

import { useNovo } from "@/components/novo/Casca";
import {
  somarDias,
  useGradeDoDia,
  useGradeDoPeriodo,
  useTiposDeAtendimento,
  type ProfissionalDaGrade,
} from "@/components/novo/dados";
import { FolhaAgendar } from "@/components/novo/FolhaAgendar";
import { FolhaDaSessao, seloDa } from "@/components/novo/FolhaDaSessao";
import { Avatar, Carregando, hora, horaDecimal, useAgora } from "@/components/novo/pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

const ALTURA_DA_HORA = 72;
const CHAVE_DA_VISAO = "novo:agenda-visao";
const ROTULO_DA_VISAO: Record<VisaoDaAgenda, string> = { dia: "Dia", semana: "Semana", mes: "Mês" };

/** A visão escolhida fica neste navegador, como a da versão atual. */
const ouvintesDaVisao = new Set<() => void>();
function assinarVisao(ouvinte: () => void): () => void {
  ouvintesDaVisao.add(ouvinte);
  return () => ouvintesDaVisao.delete(ouvinte);
}
function lerVisao(): VisaoDaAgenda {
  try {
    const guardada = window.localStorage.getItem(CHAVE_DA_VISAO);
    return VISOES_DA_AGENDA.includes(guardada as VisaoDaAgenda)
      ? (guardada as VisaoDaAgenda)
      : "dia";
  } catch {
    return "dia"; // sem armazenamento (janela privada): fica no Dia
  }
}
function gravarVisao(v: VisaoDaAgenda): void {
  try {
    window.localStorage.setItem(CHAVE_DA_VISAO, v);
  } catch {
    /* idem */
  }
  for (const o of ouvintesDaVisao) o();
}

export function Agenda() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso, meuId, soAsMinhas, role } = useNovo();
  const agora = useAgora();
  const hoje = diaLocalISO(agora, fuso);
  const [dia, setDia] = React.useState(hoje);
  const visao = React.useSyncExternalStore(assinarVisao, lerVisao, () => "dia" as const);
  const setVisao = gravarVisao;
  const [daEquipe, setDaEquipe] = React.useState(false);
  const grade = useGradeDoDia(dia, fuso);
  const diasDoPeriodo = diasDaVisao(visao, dia);
  const periodo = useGradeDoPeriodo(
    diasDoPeriodo[0]!,
    diasDoPeriodo[diasDoPeriodo.length - 1]!,
    fuso,
    visao !== "dia",
  );
  const tipos = useTiposDeAtendimento();
  const [aberta, setAberta] = React.useState<string | null>(null);
  const [agendar, setAgendar] = React.useState(false);

  const todos = grade.data?.profissionais ?? [];
  // "Ver agenda da equipe toda": todas as colunas, a minha primeiro. Mexer na sessão de um colega
  // segue a regra de sempre (a opção "Atendentes podem mexer na agenda dos colegas", no servidor).
  const colunas: ProfissionalDaGrade[] = soAsMinhas
    ? daEquipe
      ? [...todos].sort((a, b) => Number(b.user_id === meuId) - Number(a.user_id === meuId))
      : todos.filter((p) => p.user_id === meuId)
    : todos;
  const ids = new Set(colunas.map((c) => c.user_id));
  const sessoes = (grade.data?.sessoes ?? []).filter(
    (s) => s.status !== "cancelled" && (soAsMinhas ? ids.has(s.profissional_user_id ?? "") : true),
  );
  const semDono = soAsMinhas
    ? []
    : sessoes.filter((s) => !s.profissional_user_id || !ids.has(s.profissional_user_id));
  const janela = janelaDoDia(
    sessoes.map((s) => ({
      inicio: horaDecimal(s.inicio, fuso),
      fim: horaDecimal(s.fim, fuso) || 24,
    })),
  );
  const horas = Array.from({ length: janela.ate - janela.de }, (_, i) => janela.de + i);
  const agoraH = horaDecimal(agora.toISOString(), fuso);

  const semana = Array.from({ length: 7 }, (_, i) => somarDias(dia, i - 3));
  const sessoesDoPeriodo = (periodo.data?.sessoes ?? []).filter(
    (s) => s.status !== "cancelled" && (soAsMinhas ? ids.has(s.profissional_user_id ?? "") : true),
  );
  const sessaoAberta =
    [...(grade.data?.sessoes ?? []), ...(periodo.data?.sessoes ?? [])].find(
      (s) => s.id === aberta,
    ) ?? null;
  const verDia = (d: string) => {
    setDia(d);
    setVisao("dia");
  };
  const nomeDe = (id: string | null) => (id && todos.find((p) => p.user_id === id)?.nome) || null;

  const meioDia = (d: string) => new Date(`${d}T12:00:00Z`);
  const tituloDoDia =
    visao === "mes"
      ? new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(
          meioDia(dia),
        )
      : visao === "semana"
        ? new Intl.DateTimeFormat(tag, {
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          }).formatRange(meioDia(diasDoPeriodo[0]!), meioDia(diasDoPeriodo[6]!))
        : new Intl.DateTimeFormat(tag, {
            weekday: "long",
            day: "numeric",
            month: "long",
            timeZone: "UTC",
          }).format(meioDia(dia));
  const contemHoje = diasDoPeriodo.includes(hoje);

  return (
    <div className="n-conteudo" data-testid="novo-agenda">
      <header className="n-entra flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="n-suave text-sm font-semibold">
            {visao !== "dia"
              ? t(ROTULO_DA_VISAO[visao])
              : dia === hoje
                ? t("Hoje")
                : dia < hoje
                  ? t("Dia que passou")
                  : t("Próximos dias")}
          </p>
          <h1 className="n-titulo n-inicial mt-1 text-[38px] leading-tight sm:text-[46px]">
            {tituloDoDia}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <div
            className="flex gap-1 rounded-full bg-[var(--n-cartao)] p-1"
            role="group"
            aria-label={t("Visão da agenda")}
          >
            {VISOES_DA_AGENDA.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={visao === v}
                onClick={() => setVisao(v)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  visao === v ? "bg-[var(--n-forte)] text-[var(--n-forte-tinta)]" : "n-suave"
                }`}
                data-testid={`novo-visao-${v}`}
              >
                {t(ROTULO_DA_VISAO[v])}
              </button>
            ))}
          </div>
          {soAsMinhas && (
            <button
              type="button"
              className="n-chip"
              aria-pressed={daEquipe}
              onClick={() => setDaEquipe((v) => !v)}
            >
              {daEquipe ? t("Ver só a minha") : t("Ver agenda da equipe toda")}
            </button>
          )}
          {role !== "viewer" && (
            <button
              type="button"
              className="n-botao n-botao-principal"
              onClick={() => setAgendar(true)}
            >
              + Agendar
            </button>
          )}
        </div>
      </header>

      {visao !== "dia" && (
        <div className="n-entra mt-6 flex items-center gap-2">
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            aria-label={visao === "mes" ? t("Mês anterior") : t("Semana anterior")}
            onClick={() => setDia((d) => andar(visao, d, -1))}
            data-testid="novo-agenda-anterior"
          >
            ‹
          </button>
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            aria-label={visao === "mes" ? t("Próximo mês") : t("Próxima semana")}
            onClick={() => setDia((d) => andar(visao, d, 1))}
            data-testid="novo-agenda-seguinte"
          >
            ›
          </button>
          {!contemHoje && (
            <button
              type="button"
              className="n-botao n-botao-escuro n-botao-pequeno"
              onClick={() => setDia(hoje)}
            >
              {t("Hoje")}
            </button>
          )}
        </div>
      )}

      {visao === "dia" && (
        <div className="n-entra mt-6 flex items-center gap-2">
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            aria-label={t("Semana anterior")}
            onClick={() => setDia((d) => somarDias(d, -7))}
          >
            ‹
          </button>
          <div className="grid flex-1 grid-cols-7 gap-1.5">
            {semana.map((d) => {
              const data = new Date(`${d}T12:00:00Z`);
              const ativo = d === dia;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setDia(d)}
                  className={`flex flex-col items-center rounded-2xl py-2 text-xs font-semibold transition-colors ${
                    ativo
                      ? "bg-[var(--n-forte)] text-[var(--n-forte-tinta)]"
                      : d === hoje
                        ? "bg-[var(--n-acao-suave)] text-[var(--n-acao)]"
                        : "bg-[var(--n-cartao)]"
                  }`}
                >
                  <span className="n-inicial opacity-70">
                    {new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" })
                      .format(data)
                      .replace(".", "")}
                  </span>
                  <span className="n-titulo n-numero text-xl">{data.getUTCDate()}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            aria-label={t("Próxima semana")}
            onClick={() => setDia((d) => somarDias(d, 7))}
          >
            ›
          </button>
          {dia !== hoje && (
            <button
              type="button"
              className="n-botao n-botao-escuro n-botao-pequeno"
              onClick={() => setDia(hoje)}
            >
              {t("Hoje")}
            </button>
          )}
        </div>
      )}

      {visao === "semana" && (
        <div className="n-cartao n-entra mt-6 overflow-hidden">
          {periodo.isLoading ? (
            <div className="p-6">
              <Carregando />
            </div>
          ) : (
            <GradeDaSemana
              dias={diasDoPeriodo}
              sessoes={sessoesDoPeriodo}
              hoje={hoje}
              agora={agora}
              fuso={fuso}
              aoAbrir={setAberta}
              aoVerDia={verDia}
            />
          )}
        </div>
      )}

      {visao === "mes" && (
        <div className="n-entra mt-6">
          {periodo.isLoading ? (
            <div className="n-cartao p-6">
              <Carregando />
            </div>
          ) : (
            <GradeDoMes
              dias={diasDoPeriodo}
              sessoes={sessoesDoPeriodo}
              hoje={hoje}
              fuso={fuso}
              aoAbrir={setAberta}
              aoVerDia={verDia}
            />
          )}
        </div>
      )}

      {visao === "dia" && (
        <div className="n-cartao n-entra mt-6 overflow-hidden">
          {grade.isLoading ? (
            <div className="p-6">
              <Carregando />
            </div>
          ) : colunas.length === 0 && semDono.length === 0 ? (
            <p className="n-suave p-8 text-center">
              {t(
                "Nenhum profissional de saúde cadastrado. O administrador cadastra em Configurações › Profissionais de saúde.",
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `56px repeat(${colunas.length + (semDono.length ? 1 : 0)}, minmax(190px, 1fr))`,
                }}
              >
                {/* Cabeçalho */}
                <div className="sticky left-0 z-10 border-b border-[var(--n-linha)] bg-[var(--n-cartao)]" />
                {colunas.map((p) => (
                  <div
                    key={p.user_id}
                    className="flex items-center gap-2.5 border-b border-l border-[var(--n-linha)] px-4 py-3"
                  >
                    <Avatar nome={p.nome} tamanho={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">
                        {p.nome}
                        {p.user_id === meuId ? ` (${t("você")})` : ""}
                      </span>
                      <span className="n-fraco block truncate text-xs">
                        {sessoes.filter((s) => s.profissional_user_id === p.user_id).length}{" "}
                        {t("sessões")}
                      </span>
                    </span>
                  </div>
                ))}
                {semDono.length > 0 && (
                  <div className="flex items-center border-b border-l border-[var(--n-linha)] px-4 py-3 text-sm font-bold">
                    {t("Sem profissional")}
                  </div>
                )}

                {/* Corpo */}
                <div className="sticky left-0 z-10 bg-[var(--n-cartao)]">
                  {horas.map((h) => (
                    <div
                      key={h}
                      className="n-fraco n-numero relative text-right text-[11px] font-semibold"
                      style={{ height: ALTURA_DA_HORA }}
                    >
                      <span className="absolute -top-2 right-2">{h}h</span>
                    </div>
                  ))}
                </div>
                {[...colunas.map((c) => c.user_id), ...(semDono.length ? ["__sem"] : [])].map(
                  (col) => {
                    const daColuna =
                      col === "__sem"
                        ? semDono
                        : sessoes.filter((s) => s.profissional_user_id === col);
                    return (
                      <div
                        key={col}
                        className="relative border-l border-[var(--n-linha)]"
                        style={{
                          height: horas.length * ALTURA_DA_HORA,
                          backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ALTURA_DA_HORA - 1}px, var(--n-linha) ${ALTURA_DA_HORA - 1}px, var(--n-linha) ${ALTURA_DA_HORA}px)`,
                        }}
                      >
                        {dia === hoje && agoraH >= janela.de && agoraH <= janela.ate && (
                          <div
                            className="pointer-events-none absolute inset-x-0 z-[2] h-0.5 bg-[var(--n-alerta)]"
                            style={{ top: (agoraH - janela.de) * ALTURA_DA_HORA }}
                          />
                        )}
                        {(() => {
                          const faixas = faixasDe(daColuna, fuso);
                          return daColuna.map((s) => (
                            <Bloco
                              key={s.id}
                              sessao={s}
                              janelaDe={janela.de}
                              agora={agora}
                              fuso={fuso}
                              faixa={faixas.get(s.id)}
                              aoAbrir={() => setAberta(s.id)}
                            />
                          ));
                        })()}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <FolhaDaSessao
        key={sessaoAberta?.id ?? "nenhuma"}
        sessao={sessaoAberta}
        politica={grade.data?.politica ?? POLITICA_PADRAO}
        precoCents={
          (sessaoAberta?.tipo &&
            tipos.data?.find((t) => t.event_type_id === sessaoAberta.tipo!.id)?.preco_cents) ??
          null
        }
        nomeDoProfissional={sessaoAberta ? nomeDe(sessaoAberta.profissional_user_id) : null}
        aoFechar={() => setAberta(null)}
      />
      <FolhaAgendar aberta={agendar} aoFechar={() => setAgendar(false)} profissionais={todos} />
    </div>
  );
}

function faixasDe(sessoes: readonly SessaoDaGrade[], fuso: string) {
  return faixasLadoALado(
    sessoes.map((s) => ({
      id: s.id,
      inicio: horaDecimal(s.inicio, fuso),
      fim: horaDecimal(s.fim, fuso) || 24,
    })),
  );
}

/** Semana: uma coluna por dia, de segunda a domingo, com a mesma régua de horas do Dia. */
function GradeDaSemana({
  dias,
  sessoes,
  hoje,
  agora,
  fuso,
  aoAbrir,
  aoVerDia,
}: {
  dias: string[];
  sessoes: SessaoDaGrade[];
  hoje: string;
  agora: Date;
  fuso: string;
  aoAbrir: (id: string) => void;
  aoVerDia: (dia: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const janela = janelaDoDia(
    sessoes.map((s) => ({
      inicio: horaDecimal(s.inicio, fuso),
      fim: horaDecimal(s.fim, fuso) || 24,
    })),
  );
  const horas = Array.from({ length: janela.ate - janela.de }, (_, i) => janela.de + i);
  const agoraH = horaDecimal(agora.toISOString(), fuso);
  const doDia = (d: string) => sessoes.filter((s) => diaLocalISO(new Date(s.inicio), fuso) === d);
  return (
    <div className="overflow-x-auto" data-testid="novo-agenda-semana">
      <div
        className="grid"
        style={{ gridTemplateColumns: `56px repeat(${dias.length}, minmax(132px, 1fr))` }}
      >
        <div className="sticky left-0 z-10 border-b border-[var(--n-linha)] bg-[var(--n-cartao)]" />
        {dias.map((d) => {
          const data = new Date(`${d}T12:00:00Z`);
          const quantas = doDia(d).length;
          return (
            <button
              key={d}
              type="button"
              onClick={() => aoVerDia(d)}
              className={`flex items-center gap-2 border-b border-l border-[var(--n-linha)] px-3 py-2.5 text-left ${
                d === hoje ? "bg-[var(--n-acao-suave)] text-[var(--n-acao)]" : ""
              }`}
              data-testid="novo-semana-dia"
            >
              <span className="n-titulo n-numero text-2xl leading-none">{data.getUTCDate()}</span>
              <span className="min-w-0">
                <span className="n-inicial block text-xs font-bold">
                  {new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" })
                    .format(data)
                    .replace(".", "")}
                </span>
                <span className="n-fraco block truncate text-[11px]">
                  {quantas} {quantas === 1 ? t("sessão") : t("sessões")}
                </span>
              </span>
            </button>
          );
        })}

        <div className="sticky left-0 z-10 bg-[var(--n-cartao)]">
          {horas.map((h) => (
            <div
              key={h}
              className="n-fraco n-numero relative text-right text-[11px] font-semibold"
              style={{ height: ALTURA_DA_HORA }}
            >
              <span className="absolute -top-2 right-2">{h}h</span>
            </div>
          ))}
        </div>
        {dias.map((d) => {
          const daColuna = doDia(d);
          const faixas = faixasDe(daColuna, fuso);
          return (
            <div
              key={d}
              className="relative border-l border-[var(--n-linha)]"
              style={{
                height: horas.length * ALTURA_DA_HORA,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ALTURA_DA_HORA - 1}px, var(--n-linha) ${ALTURA_DA_HORA - 1}px, var(--n-linha) ${ALTURA_DA_HORA}px)`,
              }}
            >
              {d === hoje && agoraH >= janela.de && agoraH <= janela.ate && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-[2] h-0.5 bg-[var(--n-alerta)]"
                  style={{ top: (agoraH - janela.de) * ALTURA_DA_HORA }}
                />
              )}
              {daColuna.map((s) => (
                <Bloco
                  key={s.id}
                  sessao={s}
                  janelaDe={janela.de}
                  agora={agora}
                  fuso={fuso}
                  faixa={faixas.get(s.id)}
                  compacto
                  aoAbrir={() => aoAbrir(s.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const NO_DIA_DO_MES = 3;

/** Mês: o calendário de segunda a domingo; o dia abre no Dia, a sessão abre a folha. */
function GradeDoMes({
  dias,
  sessoes,
  hoje,
  fuso,
  aoAbrir,
  aoVerDia,
}: {
  dias: string[];
  sessoes: SessaoDaGrade[];
  hoje: string;
  fuso: string;
  aoAbrir: (id: string) => void;
  aoVerDia: (dia: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const porDia = new Map<string, SessaoDaGrade[]>();
  for (const s of sessoes) {
    const d = diaLocalISO(new Date(s.inicio), fuso);
    porDia.set(d, [...(porDia.get(d) ?? []), s]);
  }
  const vazios = diaDaSemana(dias[0]!);
  // 5 de outubro de 2026 é uma segunda: os nomes dos dias saem dela, no idioma da pessoa.
  const nomes = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2026, 9, 5 + i, 12)))
      .replace(".", ""),
  );
  return (
    <div data-testid="novo-agenda-mes">
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {nomes.map((n) => (
          <p key={n} className="n-fraco n-inicial px-1 pb-1 text-center text-xs font-bold">
            {n}
          </p>
        ))}
        {Array.from({ length: vazios }, (_, i) => (
          <div key={`vazio-${i}`} aria-hidden />
        ))}
        {dias.map((d) => {
          const doDia = porDia.get(d) ?? [];
          const numero = Number(d.slice(8));
          return (
            <div
              key={d}
              className={`n-cartao flex min-h-[64px] min-w-0 flex-col gap-1 p-1.5 sm:min-h-[112px] sm:p-2 ${
                d === hoje ? "ring-2 ring-[var(--n-acao)]" : ""
              }`}
              data-testid="novo-mes-dia"
            >
              <button
                type="button"
                onClick={() => aoVerDia(d)}
                className="flex items-center justify-between gap-1 text-left"
                aria-label={new Intl.DateTimeFormat(tag, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "UTC",
                }).format(new Date(`${d}T12:00:00Z`))}
              >
                <span
                  className={`n-numero text-sm font-bold ${d === hoje ? "text-[var(--n-acao)]" : ""}`}
                >
                  {numero}
                </span>
                {doDia.length > 0 && (
                  <span className="sm:hidden">
                    <span className="n-selo n-selo-neutro px-1.5 text-[10px]">{doDia.length}</span>
                  </span>
                )}
              </button>
              <div className="hidden min-w-0 gap-0.5 sm:grid">
                {doDia.slice(0, NO_DIA_DO_MES).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => aoAbrir(s.id)}
                    className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-[11.5px] hover:bg-[var(--n-papel)]"
                    data-testid="novo-mes-sessao"
                  >
                    <span
                      className="h-2 w-2 flex-none rounded-full"
                      style={{ background: `var(--agenda-modalidade-${s.modalidade ?? "outra"})` }}
                      aria-hidden
                    />
                    <span className="n-numero n-fraco flex-none">{hora(s.inicio, fuso)}</span>
                    <span className="truncate font-semibold">{s.paciente?.nome ?? s.titulo}</span>
                  </button>
                ))}
                {doDia.length > NO_DIA_DO_MES && (
                  <button
                    type="button"
                    onClick={() => aoVerDia(d)}
                    className="n-suave px-1 text-left text-[11px] font-semibold hover:underline"
                  >
                    +{doDia.length - NO_DIA_DO_MES} {t("mais")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bloco({
  sessao,
  janelaDe,
  agora,
  fuso,
  faixa,
  compacto = false,
  aoAbrir,
}: {
  sessao: SessaoDaGrade;
  janelaDe: number;
  agora: Date;
  fuso: string;
  /** Sessões sobrepostas no mesmo dia dividem a largura da coluna. */
  faixa?: { faixa: number; faixas: number };
  /** Coluna estreita (a Semana, ou sessões lado a lado): sem o selo, só hora e nome. */
  compacto?: boolean;
  aoAbrir: () => void;
}) {
  const inicio = horaDecimal(sessao.inicio, fuso);
  const fim = horaDecimal(sessao.fim, fuso) || 24;
  const cor = `var(--agenda-modalidade-${sessao.modalidade ?? "outra"})`;
  const selo = seloDa(sessao, agora);
  const encerrada = sessao.status === "completed" || sessao.status === "no_show";
  const altura = Math.max(30, (fim - inicio) * ALTURA_DA_HORA - 4);
  const estreito = compacto || (faixa?.faixas ?? 1) > 1;
  const nome = sessao.paciente?.nome ?? sessao.titulo;
  return (
    <button
      type="button"
      onClick={aoAbrir}
      title={`${hora(sessao.inicio, fuso)} · ${nome} · ${selo.rotulo}`}
      className={`absolute z-[1] overflow-hidden rounded-2xl ${estreito ? "px-2" : "px-3"} text-left ${altura < 46 ? "py-1.5" : "py-2"} transition-transform hover:-translate-y-0.5`}
      style={{
        left: `calc(${((faixa?.faixa ?? 0) / (faixa?.faixas ?? 1)) * 100}% + 6px)`,
        width: `calc(${100 / (faixa?.faixas ?? 1)}% - 12px)`,
        top: (inicio - janelaDe) * ALTURA_DA_HORA + 2,
        height: altura,
        background: `color-mix(in oklab, ${cor} ${encerrada ? 8 : 16}%, var(--n-cartao))`,
        borderLeft: `4px solid ${cor}`,
        opacity: encerrada ? 0.65 : 1,
        borderLeftStyle: sessao.status === "pending" ? "dashed" : "solid",
      }}
      data-testid="novo-bloco"
    >
      {altura < 46 ? (
        <span className="flex items-baseline gap-2 truncate text-[13px] font-bold">
          <span className="n-numero text-[11px]" style={{ color: cor }}>
            {hora(sessao.inicio, fuso)}
          </span>
          <span className="truncate">{nome}</span>
        </span>
      ) : (
        <>
          <span className="n-numero block truncate text-[11px] font-bold" style={{ color: cor }}>
            {hora(sessao.inicio, fuso)}
            {estreito ? "" : ` · ${selo.rotulo}`}
          </span>
          <span className="block truncate text-[13.5px] font-bold">{nome}</span>
          {altura > 60 && (
            <span className="n-suave block truncate text-xs">{sessao.tipo?.nome}</span>
          )}
        </>
      )}
    </button>
  );
}
