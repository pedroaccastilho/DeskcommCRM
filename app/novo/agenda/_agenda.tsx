"use client";

/**
 * AGENDA da interface nova: um dia por vez, uma coluna por profissional, blocos na cor da
 * modalidade. Quem atende abre na própria coluna e pode ver a equipe da MESMA área (a
 * fisioterapeuta vê fisioterapia, não medicina); recepção e gestão veem todos.
 */
import * as React from "react";

import { diaLocalISO } from "@/lib/agenda/fuso";
import { POLITICA_PADRAO, type SessaoDaGrade } from "@/lib/clinica/agenda";
import { janelaDoDia } from "@/lib/novo/hoje";

import { useNovo } from "@/components/novo/Casca";
import {
  somarDias,
  useGradeDoDia,
  useTiposDeAtendimento,
  type ProfissionalDaGrade,
} from "@/components/novo/dados";
import { FolhaAgendar } from "@/components/novo/FolhaAgendar";
import { FolhaDaSessao, seloDa } from "@/components/novo/FolhaDaSessao";
import { Avatar, Carregando, hora, horaDecimal, useAgora } from "@/components/novo/pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

const ALTURA_DA_HORA = 72;

export function Agenda() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso, meuId, soAsMinhas, modalidades, role } = useNovo();
  const agora = useAgora();
  const hoje = diaLocalISO(agora, fuso);
  const [dia, setDia] = React.useState(hoje);
  const [daEquipe, setDaEquipe] = React.useState(false);
  const grade = useGradeDoDia(dia, fuso);
  const tipos = useTiposDeAtendimento();
  const [aberta, setAberta] = React.useState<string | null>(null);
  const [agendar, setAgendar] = React.useState(false);

  const todos = grade.data?.profissionais ?? [];
  const daMinhaArea = (p: ProfissionalDaGrade) =>
    !modalidades || p.modalidades.some((m) => modalidades.includes(m));
  const colunas: ProfissionalDaGrade[] = soAsMinhas
    ? daEquipe
      ? todos.filter(daMinhaArea).sort((a) => (a.user_id === meuId ? -1 : 1))
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
  const sessaoAberta = (grade.data?.sessoes ?? []).find((s) => s.id === aberta) ?? null;
  const nomeDe = (id: string | null) => (id && todos.find((p) => p.user_id === id)?.nome) || null;

  const tituloDoDia = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dia}T12:00:00Z`));

  return (
    <div className="n-conteudo" data-testid="novo-agenda">
      <header className="n-entra flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="n-suave text-sm font-semibold">
            {dia === hoje ? t("Hoje") : dia < hoje ? t("Dia que passou") : t("Próximos dias")}
          </p>
          <h1 className="n-titulo n-inicial mt-1 text-[38px] leading-tight sm:text-[46px]">
            {tituloDoDia}
          </h1>
        </div>
        <div className="flex gap-2">
          {soAsMinhas && (
            <button
              type="button"
              className="n-chip"
              aria-pressed={daEquipe}
              onClick={() => setDaEquipe((v) => !v)}
            >
              {daEquipe ? t("Ver só a minha") : t("Ver a equipe da minha área")}
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

      <div className="n-entra mt-6 flex items-center gap-2">
        <button
          type="button"
          className="n-botao n-botao-suave n-botao-pequeno"
          aria-label="Semana anterior"
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
            Hoje
          </button>
        )}
      </div>

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
                      {daColuna.map((s) => (
                        <Bloco
                          key={s.id}
                          sessao={s}
                          janelaDe={janela.de}
                          agora={agora}
                          fuso={fuso}
                          aoAbrir={() => setAberta(s.id)}
                        />
                      ))}
                    </div>
                  );
                },
              )}
            </div>
          </div>
        )}
      </div>

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

function Bloco({
  sessao,
  janelaDe,
  agora,
  fuso,
  aoAbrir,
}: {
  sessao: SessaoDaGrade;
  janelaDe: number;
  agora: Date;
  fuso: string;
  aoAbrir: () => void;
}) {
  const inicio = horaDecimal(sessao.inicio, fuso);
  const fim = horaDecimal(sessao.fim, fuso) || 24;
  const cor = `var(--agenda-modalidade-${sessao.modalidade ?? "outra"})`;
  const selo = seloDa(sessao, agora);
  const encerrada = sessao.status === "completed" || sessao.status === "no_show";
  const altura = Math.max(30, (fim - inicio) * ALTURA_DA_HORA - 4);
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={`absolute inset-x-1.5 z-[1] overflow-hidden rounded-2xl px-3 text-left ${altura < 46 ? "py-1.5" : "py-2"} transition-transform hover:-translate-y-0.5`}
      style={{
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
          <span className="truncate">{sessao.paciente?.nome ?? sessao.titulo}</span>
        </span>
      ) : (
        <>
          <span className="n-numero block text-[11px] font-bold" style={{ color: cor }}>
            {hora(sessao.inicio, fuso)} · {selo.rotulo}
          </span>
          <span className="block truncate text-[13.5px] font-bold">
            {sessao.paciente?.nome ?? sessao.titulo}
          </span>
          {altura > 60 && (
            <span className="n-suave block truncate text-xs">{sessao.tipo?.nome}</span>
          )}
        </>
      )}
    </button>
  );
}
