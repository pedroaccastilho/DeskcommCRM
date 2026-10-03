"use client";

/**
 * O Balcão da recepção, lado de tela. A regra (situação, filtros, ação principal) mora em
 * `lib/clinica/balcao.ts`; as janelas de remarcar, cancelar e WhatsApp em
 * `components/clinica/JanelasDaSessao.tsx`. Aqui fica só o desenho e a fiação.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { AvatarDaPessoa } from "@/components/agenda/AvatarDaPessoa";
import {
  JanelaCancelar,
  JanelaRemarcar,
  JanelaWhatsApp,
  useRecarregarBalcao,
} from "@/components/clinica/JanelasDaSessao";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { usePessoasDaAgenda } from "@/hooks/agenda/usePessoasDaAgenda";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { instanteDe } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { POLITICA_PADRAO, type PoliticaDaAgenda, type SessaoDaGrade } from "@/lib/clinica/agenda";
import {
  FILTROS_DO_BALCAO,
  acoesDoBalcao,
  contagemPorFiltro,
  faltaLiberada,
  filaDoDia,
  type AcaoDoBalcao,
  type FiltroDoBalcao,
  type SituacaoNoBalcao,
} from "@/lib/clinica/balcao";
import { corDaModalidade } from "@/lib/clinica/cores-da-agenda";
import { formatCents, moedaServidaOu } from "@/lib/money";
import { cn } from "@/lib/utils";

interface GradeDoDia {
  sessoes: SessaoDaGrade[];
  politica: PoliticaDaAgenda;
}

interface TipoDeAtendimento {
  event_type_id: string;
  preco_cents: number | null;
}

interface MultaPendente {
  id: string;
  contact_id: string;
  valor_cents: number | null;
  percentual: number;
  calendar_appointments: { starts_at: string } | null;
}

const ROTULO_DO_FILTRO: Record<FiltroDoBalcao, string> = {
  hoje: "Hoje",
  sem_confirmacao: "Sem confirmação",
  a_caminho: "A caminho",
  atrasado: "Passou do horário",
  encerrado: "Encerrados",
};

const SITUACAO: Record<
  SituacaoNoBalcao,
  { rotulo: string; variante: "warning" | "info" | "error" | "neutral" | "success" }
> = {
  sem_confirmacao: { rotulo: "Sem confirmação", variante: "warning" },
  confirmado: { rotulo: "Confirmado", variante: "info" },
  atrasado: { rotulo: "Passou do horário", variante: "error" },
  realizado: { rotulo: "Realizado", variante: "neutral" },
  faltou: { rotulo: "Faltou", variante: "error" },
  cancelado: { rotulo: "Cancelado", variante: "neutral" },
};

const ROTULO_DA_ACAO: Record<AcaoDoBalcao, string> = {
  confirmar: "Confirmar presença",
  faltou: "Faltou",
  remarcar: "Remarcar",
  whatsapp: "WhatsApp",
  cancelar: "Cancelar",
  ficha: "Abrir ficha",
};

/** Os limites do dia `AAAA-MM-DD` no fuso da organização. */
function limitesDoDia(hoje: string, fuso: string): { de: string; ate: string } {
  const [ano, mes, dia] = hoje.split("-").map(Number) as [number, number, number];
  const amanha = new Date(Date.UTC(ano, mes - 1, dia + 1, 12));
  return {
    de: instanteDe({ ano, mes, dia }, fuso).toISOString(),
    ate: instanteDe(
      { ano: amanha.getUTCFullYear(), mes: amanha.getUTCMonth() + 1, dia: amanha.getUTCDate() },
      fuso,
    ).toISOString(),
  };
}

/** O relógio da tela anda sozinho: a falta libera e o atraso aparece sem recarregar. */
function useAgora(): Date {
  const [agora, setAgora] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return agora;
}

export function Balcao({ fuso, hoje }: { fuso: string; hoje: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const org = useActiveOrg();
  const agora = useAgora();
  const [filtro, setFiltro] = React.useState<FiltroDoBalcao>("hoje");
  const [escolhida, setEscolhida] = React.useState<string | null>(null);
  const limites = React.useMemo(() => limitesDoDia(hoje, fuso), [hoje, fuso]);

  const grade = useQuery({
    queryKey: ["clinica", "balcao", hoje],
    queryFn: async () =>
      (
        await apiClient.get<{ data: GradeDoDia }>(
          `/api/v1/clinica/agenda?de=${encodeURIComponent(limites.de)}&ate=${encodeURIComponent(limites.ate)}&incluir_canceladas=1`,
        )
      ).data,
    refetchInterval: 60_000,
    retry: false,
  });
  const tipos = useQuery({
    queryKey: ["clinica", "tipos-atendimento"],
    queryFn: async () =>
      (await apiClient.get<{ data: TipoDeAtendimento[] }>("/api/v1/clinica/tipos-atendimento"))
        .data,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const multas = useQuery({
    queryKey: ["clinica", "multas", "pendente"],
    queryFn: async () =>
      (await apiClient.get<{ data: MultaPendente[] }>("/api/v1/clinica/multas?status=pendente"))
        .data,
    retry: false,
  });
  const pessoas = usePessoasDaAgenda();
  const contagemDoInbox = useConversationCounts(org?.orgId ?? null);

  const sessoes = React.useMemo(() => grade.data?.sessoes ?? [], [grade.data]);
  const fila = filaDoDia(sessoes, agora, filtro);
  const contagem = contagemPorFiltro(sessoes, agora);
  const selecionada =
    sessoes.find((s) => s.id === escolhida) ??
    // Sem escolha, o painel abre no próximo paciente, que é quem a recepção vai receber.
    filaDoDia(sessoes, agora, "hoje").find(
      (s) =>
        s.situacao === "atrasado" ||
        s.situacao === "sem_confirmacao" ||
        s.situacao === "confirmado",
    ) ??
    null;

  const hora = (iso: string) =>
    new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: fuso }).format(
      new Date(iso),
    );
  const pessoa = (id: string | null) => (id ? pessoas.data?.find((p) => p.id === id) : undefined);
  const dataDeHoje = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: fuso,
  }).format(new Date(limites.de));
  const esperando = contagemDoInbox.data?.fila ?? contagemDoInbox.data?.unassigned ?? 0;

  if (grade.error instanceof ApiError && grade.error.code === "module_not_installed") {
    return (
      <Card className="p-4 text-sm text-text-muted" role="status">
        {t("O módulo clínica não está instalado nesta organização.")}
      </Card>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="balcao">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("Balcão")}</h1>
          <p className="text-sm text-text-muted first-letter:uppercase">{dataDeHoje}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {esperando > 0 ? (
            <Button asChild variant="outline" data-testid="conversas-esperando">
              <Link href="/app/inbox">
                {esperando === 1
                  ? t("1 conversa esperando uma pessoa")
                  : `${esperando} ${t("conversas esperando uma pessoa")}`}
              </Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/app/agenda">{t("Agendar")}</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Filtrar a fila")}>
        {FILTROS_DO_BALCAO.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            data-testid={`filtro-${f}`}
            className={cn(
              "flex items-baseline gap-2 rounded-lg border bg-surface px-3 py-2 text-sm transition-colors",
              filtro === f
                ? "border-accent ring-1 ring-accent"
                : "border-border hover:border-accent",
            )}
          >
            <span className="text-base font-semibold tabular-nums">{contagem[f]}</span>
            <span>{t(ROTULO_DO_FILTRO[f])}</span>
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="overflow-hidden p-0" data-testid="fila-do-dia">
          {grade.isLoading ? (
            <p className="p-4 text-sm text-text-muted">{t("Carregando o dia…")}</p>
          ) : fila.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">
              {filtro === "hoje"
                ? t("Nenhum horário marcado para hoje.")
                : t("Ninguém nesta situação agora.")}
            </p>
          ) : (
            <ul>
              {fila.map((s) => {
                const quem = pessoa(s.profissional_user_id);
                const encerrada =
                  s.situacao === "realizado" ||
                  s.situacao === "faltou" ||
                  s.situacao === "cancelado";
                return (
                  <li key={s.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setEscolhida(s.id)}
                      aria-current={selecionada?.id === s.id}
                      data-testid={`fila-${s.id}`}
                      className={cn(
                        "grid w-full grid-cols-[3.25rem_4px_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 text-left transition-colors sm:grid-cols-[3.25rem_4px_minmax(0,1fr)_auto]",
                        selecionada?.id === s.id ? "bg-accent-soft" : "hover:bg-surface-elevated",
                        encerrada && "opacity-60",
                      )}
                    >
                      <span className="text-right text-sm font-semibold tabular-nums">
                        {hora(s.inicio)}
                      </span>
                      <span
                        aria-hidden
                        className="h-full min-h-9 rounded-full"
                        style={{ backgroundColor: corDaModalidade(s.modalidade) }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {s.paciente?.nome ?? s.titulo}
                        </span>
                        <span className="block truncate text-xs text-text-muted">
                          {quem
                            ? t("{tipo} com {nome}")
                                .replace("{tipo}", s.tipo?.nome ?? s.titulo)
                                .replace("{nome}", quem.nome)
                            : (s.tipo?.nome ?? s.titulo)}
                        </span>
                      </span>
                      <Badge
                        variant={SITUACAO[s.situacao].variante}
                        className="col-start-3 justify-self-start sm:col-start-auto sm:justify-self-end"
                      >
                        {t(SITUACAO[s.situacao].rotulo)}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {selecionada ? (
          <PainelDoPaciente
            key={selecionada.id}
            sessao={selecionada}
            agora={agora}
            fuso={fuso}
            hora={hora}
            politica={grade.data?.politica ?? POLITICA_PADRAO}
            precoCents={
              tipos.data?.find((x) => x.event_type_id === selecionada.tipo?.id)?.preco_cents ?? null
            }
            nomeDoProfissional={pessoa(selecionada.profissional_user_id)?.nome ?? null}
            profissional={pessoa(selecionada.profissional_user_id)}
            multas={(multas.data ?? []).filter(
              (m) => selecionada.paciente && m.contact_id === selecionada.paciente.id,
            )}
            moeda={moedaServidaOu(org?.currency)}
          />
        ) : grade.isLoading ? null : (
          <Card className="p-4 text-sm text-text-muted">
            {t("Escolha um horário na fila para ver o paciente e as ações.")}
          </Card>
        )}
      </div>
    </div>
  );
}

function PainelDoPaciente({
  sessao,
  agora,
  fuso,
  hora,
  politica,
  precoCents,
  nomeDoProfissional,
  profissional,
  multas,
  moeda,
}: {
  sessao: SessaoDaGrade;
  agora: Date;
  fuso: string;
  hora: (iso: string) => string;
  politica: PoliticaDaAgenda;
  precoCents: number | null;
  nomeDoProfissional: string | null;
  profissional: React.ComponentProps<typeof AvatarDaPessoa>["pessoa"] | undefined;
  multas: MultaPendente[];
  moeda: ReturnType<typeof moedaServidaOu>;
}) {
  const t = useT();
  const recarregar = useRecarregarBalcao();
  const [janela, setJanela] = React.useState<"remarcar" | "cancelar" | "whatsapp" | null>(null);
  const situacao = filaDoDia([sessao], agora, "hoje")[0]!.situacao;
  const acoes = acoesDoBalcao(sessao, agora);
  // Até quatro botões à vista; com só um a mais, ele aparece em vez de esconder num "Mais".
  const corte = acoes.length <= 4 ? 4 : 3;
  const visiveis = acoes.slice(0, corte);
  const extras = acoes.slice(corte);

  const registrar = useMutation({
    mutationFn: async (status: "confirmed" | "no_show") =>
      apiClient.patch("/api/v1/agenda/agendamentos", { id: sessao.id, status }),
    onSuccess: (_r, status) => {
      toast.success(status === "confirmed" ? t("Presença confirmada.") : t("Falta registrada."));
      recarregar();
    },
    onError: (err) => showApiError(err),
  });

  const executar = (acao: AcaoDoBalcao) => {
    switch (acao) {
      case "confirmar":
        registrar.mutate("confirmed");
        return;
      case "faltou":
        registrar.mutate("no_show");
        return;
      case "remarcar":
      case "cancelar":
      case "whatsapp":
        setJanela(acao);
        return;
      case "ficha":
        return;
    }
  };

  const botao = (acao: AcaoDoBalcao, principal: boolean) => {
    const bloqueada = acao === "faltou" && !faltaLiberada(sessao, agora);
    if (acao === "ficha" && sessao.paciente) {
      return (
        <Button key={acao} asChild variant="ghost">
          <Link href={`/app/contacts/${sessao.paciente.id}`}>{t(ROTULO_DA_ACAO.ficha)}</Link>
        </Button>
      );
    }
    return (
      <Button
        key={acao}
        variant={principal ? "primary" : "outline"}
        size={principal ? "lg" : "default"}
        disabled={bloqueada || registrar.isPending}
        onClick={() => executar(acao)}
        data-testid={`acao-${acao}`}
      >
        {t(ROTULO_DA_ACAO[acao])}
      </Button>
    );
  };

  const liberaEm = sessao.falta_liberada_em ?? sessao.inicio;
  const atrasoMin = Math.floor((agora.getTime() - new Date(sessao.inicio).getTime()) / 60_000);

  return (
    <Card className="grid gap-4 p-4" data-testid="painel-do-paciente">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {sessao.paciente?.nome ?? sessao.titulo}
          </h2>
          {sessao.paciente?.telefone ? (
            <p className="text-sm text-text-muted tabular-nums">{sessao.paciente.telefone}</p>
          ) : null}
        </div>
        {profissional ? <AvatarDaPessoa pessoa={profissional} tamanho="md" /> : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-l-4 border-border bg-surface px-3 py-2"
        style={{ borderLeftColor: corDaModalidade(sessao.modalidade) }}
      >
        <span className="font-semibold tabular-nums">
          {t("Hoje, {hora}").replace("{hora}", hora(sessao.inicio))}
        </span>
        <span className="text-sm">
          {nomeDoProfissional
            ? t("{tipo} com {nome}")
                .replace("{tipo}", sessao.tipo?.nome ?? sessao.titulo)
                .replace("{nome}", nomeDoProfissional)
            : (sessao.tipo?.nome ?? sessao.titulo)}
        </span>
        <Badge variant={SITUACAO[situacao].variante} className="ml-auto">
          {t(SITUACAO[situacao].rotulo)}
        </Badge>
      </div>

      {situacao === "atrasado" && !faltaLiberada(sessao, agora) ? (
        <p
          className="rounded-md bg-surface-elevated px-3 py-2 text-sm text-text-muted"
          data-testid="aviso-tolerancia"
        >
          {t("Atrasado {min} min. A falta pode ser registrada a partir das {hora}.")
            .replace("{min}", String(Math.max(atrasoMin, 0)))
            .replace("{hora}", hora(liberaEm))}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {visiveis.map((a, i) => botao(a, i === 0))}
        {extras.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" data-testid="acao-mais">
                {t("Mais")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {extras.map((a) =>
                a === "ficha" && sessao.paciente ? (
                  <DropdownMenuItem key={a} asChild>
                    <Link href={`/app/contacts/${sessao.paciente.id}`}>
                      {t(ROTULO_DA_ACAO.ficha)}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={a}
                    disabled={a === "faltou" && !faltaLiberada(sessao, agora)}
                    onSelect={() => executar(a)}
                  >
                    {t(ROTULO_DA_ACAO[a])}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {multas.length > 0 ? (
        <div
          className="rounded-lg border border-warning-fg/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg"
          data-testid="multa-em-aberto"
        >
          <p className="font-semibold">
            {multas.length === 1
              ? t("Multa em aberto")
              : t("{n} multas em aberto").replace("{n}", String(multas.length))}
          </p>
          <p>
            {multas.every((m) => m.valor_cents != null)
              ? formatCents(
                  multas.reduce((soma, m) => soma + (m.valor_cents ?? 0), 0),
                  moeda,
                )
              : t("Cancelamento em cima da hora.")}{" "}
            {t("Cobrar no próximo pagamento.")}
          </p>
        </div>
      ) : null}

      <p className="text-xs text-text-muted">
        {t(
          "A recepção vê agenda, cadastro e financeiro. O conteúdo clínico fica só com os profissionais de saúde.",
        )}
      </p>

      {/* Cada janela é montada só quando abre: começa sempre limpa e lê o relógio na hora. */}
      {janela === "remarcar" ? (
        <JanelaRemarcar sessao={sessao} fuso={fuso} aberta aoFechar={() => setJanela(null)} />
      ) : null}
      {janela === "cancelar" ? (
        <JanelaCancelar
          sessao={sessao}
          politica={politica}
          precoCents={precoCents}
          aberta
          aoFechar={() => setJanela(null)}
        />
      ) : null}
      {janela === "whatsapp" && sessao.paciente?.telefone ? (
        <JanelaWhatsApp
          sessao={sessao}
          fuso={fuso}
          nomeDoProfissional={nomeDoProfissional}
          aberta
          aoFechar={() => setJanela(null)}
        />
      ) : null}
    </Card>
  );
}
