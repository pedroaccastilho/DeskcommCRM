"use client";

/**
 * RELATÓRIOS da interface nova (`/relatorios`): como a clínica está andando no período, e a
 * exportação para a contabilidade.
 *
 * Pedido do Pedro (2026-10-04): o gerente acompanha a clínica e manda o período para um
 * financeiro externo. Quem vê: Administrador, Gerente e Financeiro, em qualquer visão (os perfis
 * somam). A conta é do banco (`fn_clinica_relatorio_gestao`); esta tela só desenha.
 */
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { apiClient } from "@/lib/api/client";
import {
  taxaDeFaltas,
  veRelatoriosDaGestao,
  type RelatorioDaGestao,
  type TipoDeExportacao,
} from "@/lib/clinica/gestao";
import type { RelatorioDeOrigens } from "@/lib/clinica/origens";
import { ROTULO_DA_MODALIDADE, type Modalidade } from "@/lib/clinica/vocabulario";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { DownloadSimple } from "@/lib/ui/icons";

import { useNovo } from "./Casca";
import { Carregando, PontoDaModalidade, Secao, Vazio } from "./pecas";

type Atalho = "mes" | "mes_passado" | "90dias" | "livre";

/** `AAAA-MM-DD` de hoje no fuso da clínica. */
function hojeNoFuso(fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date());
}

function somarDiasCivis(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function periodoDoAtalho(atalho: Exclude<Atalho, "livre">, hoje: string) {
  if (atalho === "mes") return { de: `${hoje.slice(0, 8)}01`, ate: hoje };
  if (atalho === "90dias") return { de: somarDiasCivis(hoje, -89), ate: hoje };
  const fimDoPassado = somarDiasCivis(`${hoje.slice(0, 8)}01`, -1);
  return { de: `${fimDoPassado.slice(0, 8)}01`, ate: fimDoPassado };
}

/** "1 paciente", "3 pacientes": a quantidade com a palavra no número certo. */
const conta = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dinheiro = (centavos: number) => reais.format(centavos / 100);

function useRelatorio(de: string, ate: string, habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "relatorio-gestao", de, ate],
    queryFn: async () =>
      (
        await apiClient.get<{ data: RelatorioDaGestao }>(
          `/api/v1/clinica/relatorios/gestao?de=${de}&ate=${ate}`,
        )
      ).data,
    enabled: habilitado,
    placeholderData: (anterior) => anterior,
  });
}

function useOrigens(de: string, ate: string, habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "relatorio-origens", de, ate],
    queryFn: async () =>
      (
        await apiClient.get<{ data: RelatorioDeOrigens }>(
          `/api/v1/clinica/relatorios/origens?de=${de}&ate=${ate}`,
        )
      ).data,
    enabled: habilitado,
    placeholderData: (anterior) => anterior,
  });
}

export function TelaDeRelatorios() {
  const t = useT();
  const { role, eu, fuso } = useNovo();
  const pode = veRelatoriosDaGestao(role, eu?.cargos ?? []);
  const hoje = hojeNoFuso(fuso);

  const [atalho, setAtalho] = React.useState<Atalho>("mes");
  const [livre, setLivre] = React.useState(() => periodoDoAtalho("mes", hoje));
  const periodo = atalho === "livre" ? livre : periodoDoAtalho(atalho, hoje);
  const valido = periodo.de <= periodo.ate;

  const relatorio = useRelatorio(periodo.de, periodo.ate, pode && valido);
  const origens = useOrigens(periodo.de, periodo.ate, pode && valido);

  if (!pode) {
    return (
      <div className="n-conteudo max-w-3xl" data-testid="novo-relatorios">
        <Vazio
          titulo={t("Relatórios são da gestão")}
          texto={t("Peça ao administrador o perfil de Gerente ou Financeiro.")}
        />
      </div>
    );
  }

  const r = relatorio.data;
  return (
    <div className="n-conteudo max-w-5xl" data-testid="novo-relatorios">
      <div className="n-entra">
        <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">{t("Relatórios")}</h1>
        <p className="n-suave mt-1">{t("Como a clínica está andando no período.")}</p>
      </div>

      <div
        className="mt-6 flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("Período")}
      >
        <button
          type="button"
          className="n-chip"
          aria-pressed={atalho === "mes"}
          onClick={() => setAtalho("mes")}
        >
          {t("Este mês")}
        </button>
        <button
          type="button"
          className="n-chip"
          aria-pressed={atalho === "mes_passado"}
          onClick={() => setAtalho("mes_passado")}
        >
          {t("Mês passado")}
        </button>
        <button
          type="button"
          className="n-chip"
          aria-pressed={atalho === "90dias"}
          onClick={() => setAtalho("90dias")}
        >
          {t("Últimos 90 dias")}
        </button>
        <button
          type="button"
          className="n-chip"
          aria-pressed={atalho === "livre"}
          onClick={() => {
            setLivre(periodo);
            setAtalho("livre");
          }}
          data-testid="novo-periodo-livre"
        >
          {t("Escolher datas")}
        </button>
        {atalho === "livre" && (
          <span className="flex flex-wrap items-center gap-2">
            <label className="n-suave flex items-center gap-1.5 text-sm">
              {t("De")}
              <input
                type="date"
                className="n-campo !w-auto"
                value={livre.de}
                max={livre.ate}
                onChange={(e) => e.target.value && setLivre((p) => ({ ...p, de: e.target.value }))}
                data-testid="novo-periodo-de"
              />
            </label>
            <label className="n-suave flex items-center gap-1.5 text-sm">
              {t("até")}
              <input
                type="date"
                className="n-campo !w-auto"
                value={livre.ate}
                min={livre.de}
                onChange={(e) => e.target.value && setLivre((p) => ({ ...p, ate: e.target.value }))}
                data-testid="novo-periodo-ate"
              />
            </label>
          </span>
        )}
      </div>

      {!valido ? (
        <div className="mt-6">
          <Vazio titulo={t("A data inicial vem antes da final.")} />
        </div>
      ) : relatorio.isLoading ? (
        <div className="mt-6">
          <Carregando linhas={4} />
        </div>
      ) : relatorio.error || !r ? (
        <div className="mt-6">
          <Vazio titulo={t("Não foi possível carregar o relatório.")} />
        </div>
      ) : (
        <div className={`mt-6 grid gap-8 ${relatorio.isFetching ? "opacity-70" : ""}`}>
          <Indicadores r={r} />

          <div className="grid gap-8 lg:grid-cols-2">
            <Secao titulo={t("Por profissional")}>
              <PorProfissional r={r} />
            </Secao>
            <Secao titulo={t("Por modalidade")}>
              <PorModalidade r={r} />
            </Secao>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <Secao titulo={t("Dinheiro do período")}>
              <Dinheiro r={r} />
            </Secao>
            <Secao titulo={t("De onde vieram os pacientes novos")}>
              <Origens dados={origens.data} carregando={origens.isLoading} />
            </Secao>
          </div>

          <Secao titulo={t("Exportar para a contabilidade")}>
            <Exportar de={periodo.de} ate={periodo.ate} />
          </Secao>
        </div>
      )}
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  detalhe,
  tom,
  testid,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "alerta";
  testid?: string;
}) {
  return (
    <div className="n-cartao n-entra px-5 py-4" data-testid={testid}>
      <p className="n-suave text-[13px] font-semibold">{rotulo}</p>
      <p
        className={`n-titulo n-numero mt-1 text-[26px] leading-none sm:text-[32px] ${
          tom === "alerta" ? "text-[var(--n-alerta)]" : ""
        }`}
      >
        {valor}
      </p>
      {detalhe && <p className="n-fraco mt-1.5 text-[13px]">{detalhe}</p>}
    </div>
  );
}

function Indicadores({ r }: { r: RelatorioDaGestao }) {
  const t = useT();
  const taxa = taxaDeFaltas(r.sessoes);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <Indicador
        rotulo={t("Sessões realizadas")}
        valor={String(r.sessoes.realizadas)}
        detalhe={conta(r.sessoes.marcadas, t("marcada"), t("marcadas"))}
        testid="novo-kpi-realizadas"
      />
      <Indicador
        rotulo={t("Faltas")}
        valor={taxa === null ? "—" : `${taxa}%`}
        detalhe={`${conta(r.sessoes.faltas, t("falta"), t("faltas"))} · ${conta(r.sessoes.canceladas, t("cancelada"), t("canceladas"))}`}
        tom={taxa !== null && taxa >= 15 ? "alerta" : undefined}
        testid="novo-kpi-faltas"
      />
      <Indicador
        rotulo={t("Pacotes vendidos")}
        valor={dinheiro(r.pacotes.vendidos_valor_cents)}
        detalhe={conta(r.pacotes.vendidos, t("pacote"), t("pacotes"))}
        testid="novo-kpi-pacotes"
      />
      <Indicador
        rotulo={t("Multas a receber")}
        valor={dinheiro(r.multas.pendentes_valor_cents)}
        detalhe={`${conta(r.multas.geradas, t("gerada"), t("geradas"))} · ${conta(r.multas.isentas, t("isenta"), t("isentas"))}`}
        testid="novo-kpi-multas"
      />
      <Indicador
        rotulo={t("Pacientes atendidos")}
        valor={String(r.sessoes.pacientes_atendidos)}
        testid="novo-kpi-atendidos"
      />
      <Indicador
        rotulo={t("Pacientes novos")}
        valor={String(r.pacientes_novos)}
        testid="novo-kpi-novos"
      />
    </div>
  );
}

/** Barra proporcional: o quanto da maior linha esta linha é. */
function Barra({ parte, todo }: { parte: number; todo: number }) {
  const pct = todo > 0 ? Math.max(2, Math.round((parte / todo) * 100)) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-[var(--n-papel-2)]">
      <span className="block h-full rounded-full bg-[var(--n-acao)]" style={{ width: `${pct}%` }} />
    </span>
  );
}

function PorProfissional({ r }: { r: RelatorioDaGestao }) {
  const t = useT();
  if (r.por_profissional.length === 0) {
    return <Vazio titulo={t("Nenhuma sessão no período.")} />;
  }
  const maior = Math.max(...r.por_profissional.map((p) => p.realizadas));
  return (
    <ul
      className="n-cartao divide-y divide-[var(--n-linha)] px-5"
      data-testid="novo-por-profissional"
    >
      {r.por_profissional.map((p) => {
        const taxa = taxaDeFaltas(p);
        return (
          <li key={p.user_id ?? "sem"} className="grid gap-2 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{p.nome ?? t("Sem profissional")}</span>
              <span className="n-numero text-sm">
                <b>{p.realizadas}</b>{" "}
                <span className="n-fraco">
                  {p.realizadas === 1 ? t("realizada") : t("realizadas")}
                </span>
              </span>
            </div>
            <Barra parte={p.realizadas} todo={maior} />
            <p className="n-fraco n-numero text-[13px]">
              {conta(p.pacientes, t("paciente"), t("pacientes"))} ·{" "}
              {conta(p.faltas, t("falta"), t("faltas"))}
              {taxa !== null && ` (${taxa}%)`} ·{" "}
              {conta(p.canceladas, t("cancelada"), t("canceladas"))} ·{" "}
              {conta(p.marcadas, t("marcada"), t("marcadas"))}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function PorModalidade({ r }: { r: RelatorioDaGestao }) {
  const t = useT();
  if (r.por_modalidade.length === 0) {
    return <Vazio titulo={t("Nenhuma sessão no período.")} />;
  }
  const maior = Math.max(...r.por_modalidade.map((m) => m.marcadas));
  return (
    <ul
      className="n-cartao divide-y divide-[var(--n-linha)] px-5"
      data-testid="novo-por-modalidade"
    >
      {r.por_modalidade.map((m) => (
        <li key={m.modalidade} className="grid gap-2 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2 font-semibold">
              <PontoDaModalidade modalidade={m.modalidade as Modalidade} />
              {ROTULO_DA_MODALIDADE[m.modalidade as Modalidade] ?? m.modalidade}
            </span>
            <span className="n-numero text-sm">
              <b>{m.marcadas}</b>{" "}
              <span className="n-fraco">{m.marcadas === 1 ? t("marcada") : t("marcadas")}</span>
            </span>
          </div>
          <Barra parte={m.marcadas} todo={maior} />
          <p className="n-fraco n-numero text-[13px]">
            {conta(m.realizadas, t("realizada"), t("realizadas"))} ·{" "}
            {conta(m.faltas, t("falta"), t("faltas"))} ·{" "}
            {conta(m.canceladas, t("cancelada"), t("canceladas"))}
          </p>
        </li>
      ))}
    </ul>
  );
}

function LinhaDeValor({
  rotulo,
  qtd,
  valor,
  fraco,
}: {
  rotulo: string;
  qtd?: number;
  valor: number;
  fraco?: boolean;
}) {
  return (
    <li className={`flex items-baseline justify-between gap-3 py-2.5 ${fraco ? "n-fraco" : ""}`}>
      <span>
        {rotulo}
        {qtd !== undefined && <span className="n-fraco n-numero"> · {qtd}</span>}
      </span>
      <span className="n-numero font-semibold">{dinheiro(valor)}</span>
    </li>
  );
}

function Dinheiro({ r }: { r: RelatorioDaGestao }) {
  const t = useT();
  const p = r.pacotes;
  const m = r.multas;
  return (
    <div className="n-cartao px-5 py-2" data-testid="novo-dinheiro">
      <ul className="divide-y divide-[var(--n-linha)]">
        <LinhaDeValor
          rotulo={t("Pacotes vendidos")}
          qtd={p.vendidos}
          valor={p.vendidos_valor_cents}
        />
        {p.por_modalidade.map((pm) => (
          <LinhaDeValor
            key={pm.modalidade}
            rotulo={`· ${ROTULO_DA_MODALIDADE[pm.modalidade as Modalidade] ?? pm.modalidade}`}
            qtd={pm.vendidos}
            valor={pm.valor_cents}
            fraco
          />
        ))}
        <LinhaDeValor
          rotulo={t("Pacotes cancelados")}
          qtd={p.cancelados}
          valor={p.cancelados_valor_cents}
        />
        <LinhaDeValor rotulo={t("Reembolso sugerido")} valor={p.reembolso_sugerido_cents} fraco />
        <LinhaDeValor rotulo={t("Multas pagas")} qtd={m.pagas} valor={m.pagas_valor_cents} />
        <LinhaDeValor
          rotulo={t("Multas pendentes")}
          qtd={m.pendentes}
          valor={m.pendentes_valor_cents}
        />
        <LinhaDeValor
          rotulo={t("Multas isentas")}
          qtd={m.isentas}
          valor={m.isentas_valor_cents}
          fraco
        />
        <LinhaDeValor
          rotulo={t("Sessões avulsas (preço de tabela)")}
          qtd={r.sessoes.avulsas_realizadas}
          valor={r.sessoes.avulsas_valor_tabela_cents}
          fraco
        />
      </ul>
      {p.vendidos_sem_valor > 0 && (
        <p className="n-fraco pt-1 pb-2 text-[13px]">
          {p.vendidos_sem_valor}{" "}
          {t("pacote(s) vendido(s) sem preço cadastrado não entram na soma.")}
        </p>
      )}
      <p className="n-fraco pt-1 pb-2 text-[13px]">
        {t("Avulsa a preço de tabela é estimativa: o recebido fica na comanda.")}
      </p>
    </div>
  );
}

function Origens({
  dados,
  carregando,
}: {
  dados: RelatorioDeOrigens | undefined;
  carregando: boolean;
}) {
  const t = useT();
  if (carregando) return <Carregando linhas={2} />;
  // Só as origens que trouxeram alguém no período: a lista inteira com zeros esconde o que importa.
  const comGente = dados?.origens.filter((o) => o.novos > 0) ?? [];
  if (comGente.length === 0) {
    return <Vazio titulo={t("Nenhum paciente novo no período.")} />;
  }
  const maior = Math.max(...comGente.map((o) => o.novos));
  return (
    <ul className="n-cartao divide-y divide-[var(--n-linha)] px-5" data-testid="novo-origens">
      {comGente.map((o) => (
        <li key={o.origem_id ?? "sem"} className="grid gap-2 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">
              {o.origem_id ? o.nome : t("Sem origem registrada")}
            </span>
            <span className="n-numero text-sm">
              <b>{o.novos}</b>{" "}
              <span className="n-fraco">{o.novos === 1 ? t("novo") : t("novos")}</span>
            </span>
          </div>
          <Barra parte={o.novos} todo={maior} />
          <p className="n-fraco n-numero text-[13px]">
            {o.com_pacote === 1
              ? `1 ${t("comprou pacote")}`
              : `${o.com_pacote} ${t("compraram pacote")}`}
            {o.conversao_pct !== null && ` (${o.conversao_pct}%)`} ·{" "}
            {dinheiro(o.pacotes_valor_cents)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Exportar({ de, ate }: { de: string; ate: string }) {
  const t = useT();
  const href = (tipo: TipoDeExportacao) =>
    `/api/v1/clinica/relatorios/gestao/exportar?tipo=${tipo}&de=${de}&ate=${ate}`;
  return (
    <div className="n-cartao px-5 py-4" data-testid="novo-exportar">
      <p className="n-suave text-sm">
        {t(
          "Planilhas do período escolhido, no padrão brasileiro (ponto e vírgula, vírgula nos centavos). Abrem direto no Excel.",
        )}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          className="n-botao n-botao-principal"
          href={href("resumo")}
          download
          data-testid="novo-exportar-resumo"
        >
          <DownloadSimple size={18} />
          {t("Resumo financeiro")}
        </a>
        <a
          className="n-botao n-botao-suave"
          href={href("sessoes")}
          download
          data-testid="novo-exportar-sessoes"
        >
          <DownloadSimple size={18} />
          {t("Sessões")}
        </a>
        <a
          className="n-botao n-botao-suave"
          href={href("pacotes")}
          download
          data-testid="novo-exportar-pacotes"
        >
          <DownloadSimple size={18} />
          {t("Pacotes")}
        </a>
        <a
          className="n-botao n-botao-suave"
          href={href("multas")}
          download
          data-testid="novo-exportar-multas"
        >
          <DownloadSimple size={18} />
          {t("Multas geradas")}
        </a>
      </div>
    </div>
  );
}
