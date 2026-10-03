"use client";

/**
 * Meu dia do profissional, lado de tela. A regra (meus horários, paciente da vez, repetir a
 * conduta) mora em `lib/clinica/meu-dia.ts`; o formulário de registro é o mesmo da ficha
 * (`FormularioDeRegistro`), aberto já na sessão e na modalidade dela.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import {
  JanelaProximaSessao,
  JanelaWhatsApp,
  useRecarregarBalcao,
} from "@/components/clinica/JanelasDaSessao";
import {
  FormularioDeRegistro,
  useClinicaEu,
  usePendencias,
} from "@/components/clinica/ProntuarioDoPaciente";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useUser } from "@/hooks/auth/AuthProvider";
import { useAgora } from "@/hooks/clinica/useAgora";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { SessaoDaGrade } from "@/lib/clinica/agenda";
import { faltaLiberada, type SituacaoNoBalcao } from "@/lib/clinica/balcao";
import { corDaModalidade } from "@/lib/clinica/cores-da-agenda";
import { limitesDoDia } from "@/lib/clinica/dia-no-fuso";
import {
  DIAS_ATE_A_PROXIMA_SUGERIDA,
  minhasSessoes,
  pacienteDaVez,
  proximaJaMarcada,
  proximoDoDia,
  ultimoRegistro,
  valoresParaRepetir,
  type CompromissoFuturo,
  type RegistroAnterior,
  type SessaoDoMeuDia,
} from "@/lib/clinica/meu-dia";
import {
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  camposParaMostrar,
  valorParaMostrar,
  type Modalidade,
} from "@/lib/clinica/vocabulario";
import { cn } from "@/lib/utils";

interface GradeDoDia {
  sessoes: SessaoDaGrade[];
}

interface Registro extends RegistroAnterior {
  id: string;
  appointment_id: string | null;
}

const SITUACAO: Record<
  SituacaoNoBalcao,
  { rotulo: string; variante: "warning" | "info" | "error" | "neutral" | "success" }
> = {
  sem_confirmacao: { rotulo: "Sem confirmação", variante: "warning" },
  confirmado: { rotulo: "Confirmado", variante: "info" },
  atrasado: { rotulo: "Passou do horário", variante: "error" },
  realizado: { rotulo: "Compareceu", variante: "success" },
  faltou: { rotulo: "Faltou", variante: "error" },
  cancelado: { rotulo: "Cancelado", variante: "neutral" },
};

export function MeuDia({ fuso, hoje }: { fuso: string; hoje: string }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const user = useUser();
  const agora = useAgora();
  const eu = useClinicaEu();
  const profissional = eu.data?.profissional ?? null;
  const pendencias = usePendencias(Boolean(profissional));
  const [escolhida, setEscolhida] = React.useState<string | null>(null);
  const limites = React.useMemo(() => limitesDoDia(hoje, fuso), [hoje, fuso]);

  const grade = useQuery({
    // A mesma chave do Balcão: o que a recepção marca aparece aqui, e vice-versa.
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

  const minhas = minhasSessoes(grade.data?.sessoes ?? [], user.id, agora);
  const selecionada = minhas.find((s) => s.id === escolhida) ?? pacienteDaVez(minhas, agora);
  const pendentesDeOntem = (pendencias.data ?? []).filter(
    (p) => !minhas.some((s) => s.id === p.appointment_id),
  ).length;

  const hora = (iso: string) =>
    new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", timeZone: fuso }).format(
      new Date(iso),
    );
  const dataDeHoje = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: fuso,
  }).format(new Date(limites.de));

  if (grade.error instanceof ApiError && grade.error.code === "module_not_installed") {
    return (
      <Card className="p-4 text-sm text-text-muted" role="status">
        {t("O módulo clínica não está instalado nesta organização.")}
      </Card>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="meu-dia">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t("Meu dia")}</h1>
          <p className="text-sm text-text-muted first-letter:uppercase">{dataDeHoje}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {pendentesDeOntem > 0 ? (
            <Button asChild variant="outline" data-testid="evolucoes-de-outros-dias">
              <Link href="/app/clinica/pendencias">
                {pendentesDeOntem === 1
                  ? t("1 evolução de outro dia para registrar")
                  : `${pendentesDeOntem} ${t("evoluções de outros dias para registrar")}`}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/app/agenda">{t("Minha agenda")}</Link>
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <Card className="overflow-hidden p-0" data-testid="meus-horarios">
          {grade.isLoading ? (
            <p className="p-4 text-sm text-text-muted">{t("Carregando o dia…")}</p>
          ) : minhas.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">
              {t("Nenhum horário seu marcado para hoje.")}
            </p>
          ) : (
            <ul>
              {minhas.map((s) => (
                <li key={s.id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setEscolhida(s.id)}
                    aria-current={selecionada?.id === s.id}
                    data-testid={`horario-${s.id}`}
                    className={cn(
                      "grid w-full grid-cols-[3.25rem_4px_minmax(0,1fr)] items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      selecionada?.id === s.id ? "bg-accent-soft" : "hover:bg-surface-elevated",
                      (s.situacao === "realizado" || s.situacao === "faltou") && "opacity-60",
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
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs text-text-muted">
                          {s.tipo?.nome ?? s.titulo}
                        </span>
                        <Badge variant={SITUACAO[s.situacao].variante} className="shrink-0">
                          {t(SITUACAO[s.situacao].rotulo)}
                        </Badge>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {selecionada ? (
          <ModoAtendimento
            key={selecionada.id}
            sessao={selecionada}
            proximo={proximoDoDia(minhas, selecionada.id)}
            aoChamarProximo={setEscolhida}
            agora={agora}
            fuso={fuso}
            hora={hora}
            nomeDoProfissional={profissional?.nome_profissional ?? user.full_name}
            modalidades={profissional?.modalidades ?? null}
            carregandoEu={eu.isLoading}
          />
        ) : grade.isLoading ? null : (
          <Card className="p-4 text-sm text-text-muted">
            {t("Quando houver horário seu hoje, o paciente da vez aparece aqui.")}
          </Card>
        )}
      </div>
    </div>
  );
}

function ModoAtendimento({
  sessao,
  proximo,
  aoChamarProximo,
  agora,
  fuso,
  hora,
  nomeDoProfissional,
  modalidades,
  carregandoEu,
}: {
  sessao: SessaoDoMeuDia;
  /** O próximo horário aberto do dia, para chamar depois de assinar. */
  proximo: SessaoDoMeuDia | null;
  aoChamarProximo: (id: string) => void;
  agora: Date;
  fuso: string;
  hora: (iso: string) => string;
  nomeDoProfissional: string | null;
  /** As modalidades em que a pessoa assina; `null` quando ela não é profissional de saúde. */
  modalidades: Modalidade[] | null;
  carregandoEu: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const recarregar = useRecarregarBalcao();
  const [whatsapp, setWhatsapp] = React.useState(false);
  const paciente = sessao.paciente;

  const registros = useQuery({
    // A mesma chave da aba Prontuário: assinar aqui atualiza a ficha, e vice-versa.
    queryKey: ["clinica", "prontuario", paciente?.id ?? ""],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Registro[] }>(
          `/api/v1/clinica/prontuario?contact_id=${encodeURIComponent(paciente!.id)}`,
        )
      ).data,
    enabled: Boolean(paciente && modalidades),
    retry: false,
  });

  const presenca = useMutation({
    mutationFn: async (status: "completed" | "no_show") =>
      apiClient.patch("/api/v1/agenda/agendamentos", { id: sessao.id, status }),
    onSuccess: (_r, status) => {
      toast.success(status === "completed" ? t("Presença registrada.") : t("Falta registrada."));
      recarregar();
    },
    onError: (err) => showApiError(err),
  });

  const modalidade = sessao.modalidade ?? modalidades?.[0] ?? null;
  const ultimo = modalidade ? ultimoRegistro(registros.data ?? [], modalidade) : null;
  const jaRegistrada = (registros.data ?? []).some((r) => r.appointment_id === sessao.id);
  const aberta =
    sessao.situacao === "confirmado" ||
    sessao.situacao === "sem_confirmacao" ||
    sessao.situacao === "atrasado";
  const camposDoUltimo = ultimo
    ? camposParaMostrar(ultimo.modalidade, ultimo.tipo)
        .filter((c) => ultimo.conteudo[c.chave] !== undefined && ultimo.conteudo[c.chave] !== "")
        .slice(0, 5)
    : [];

  return (
    <div className="flex flex-col gap-4" data-testid="modo-atendimento">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{paciente?.nome ?? sessao.titulo}</h2>
            <p className="text-sm text-text-muted">
              {hora(sessao.inicio)} · {sessao.tipo?.nome ?? sessao.titulo}
              {sessao.modalidade ? ` · ${t(ROTULO_DA_MODALIDADE[sessao.modalidade])}` : ""}
            </p>
          </div>
          <Badge variant={SITUACAO[sessao.situacao].variante}>
            {t(SITUACAO[sessao.situacao].rotulo)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {aberta ? (
            <Button
              size="lg"
              onClick={() => presenca.mutate("completed")}
              disabled={presenca.isPending}
              data-testid="acao-compareceu"
            >
              {t("Compareceu")}
            </Button>
          ) : null}
          {aberta && sessao.situacao === "atrasado" && faltaLiberada(sessao, agora) ? (
            <Button
              variant="outline"
              onClick={() => presenca.mutate("no_show")}
              disabled={presenca.isPending}
              data-testid="acao-faltou"
            >
              {t("Faltou")}
            </Button>
          ) : null}
          {paciente?.telefone ? (
            <Button variant="outline" onClick={() => setWhatsapp(true)} data-testid="acao-whatsapp">
              {t("WhatsApp")}
            </Button>
          ) : null}
          {paciente ? (
            <Button asChild variant="ghost">
              <Link href={`/app/contacts/${paciente.id}?aba=prontuario`}>
                {t("Prontuário completo")}
              </Link>
            </Button>
          ) : null}
        </div>
      </Card>

      {carregandoEu ? null : !modalidades ? (
        <Card className="p-4 text-sm text-text-muted" role="status">
          {t(
            "O prontuário só é visível para profissionais de saúde cadastrados e ativos na clínica. O cadastro fica em Configurações › Profissionais de saúde.",
          )}
        </Card>
      ) : !paciente ? (
        <Card className="p-4 text-sm text-text-muted">
          {t("Este horário não tem paciente vinculado.")}
        </Card>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <Card className="flex flex-col gap-2 p-4" data-testid="ultima-sessao">
            <h3 className="text-sm font-semibold">{t("Última sessão")}</h3>
            {registros.isLoading ? (
              <p className="text-sm text-text-muted">{t("Carregando…")}</p>
            ) : !ultimo ? (
              <p className="text-sm text-text-muted">
                {t("Primeira sessão deste paciente nesta modalidade.")}
              </p>
            ) : (
              <>
                <p className="text-xs text-text-muted">
                  {t(ROTULO_DO_TIPO[ultimo.tipo])} ·{" "}
                  {new Intl.DateTimeFormat(tag, {
                    day: "numeric",
                    month: "short",
                    timeZone: fuso,
                  }).format(new Date(ultimo.assinado_em))}
                </p>
                <dl className="flex flex-col gap-2 text-sm">
                  {camposDoUltimo.map((c) => (
                    <div key={c.chave}>
                      <dt className="text-xs text-text-muted">{t(c.rotulo)}</dt>
                      <dd className="whitespace-pre-wrap">
                        {c.opcoes
                          ? t(valorParaMostrar(c, ultimo.conteudo[c.chave]!))
                          : String(ultimo.conteudo[c.chave])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </Card>

          {jaRegistrada ? (
            <ProximoPasso
              sessao={sessao}
              proximo={proximo}
              aoChamarProximo={aoChamarProximo}
              agora={agora}
              fuso={fuso}
              hora={hora}
            />
          ) : (
            <FormularioDeRegistro
              contactId={paciente.id}
              sessaoInicial={sessao.id}
              modalidades={modalidades}
              modalidadeInicial={sessao.modalidade}
              paraRepetir={valoresParaRepetir(ultimo)}
              adendoDe={null}
              aoCancelarAdendo={() => undefined}
              aoAssinar={() => toast.success(t("Evolução assinada."))}
            />
          )}
        </div>
      )}

      {whatsapp ? (
        <JanelaWhatsApp
          sessao={sessao}
          fuso={fuso}
          nomeDoProfissional={nomeDoProfissional}
          aberta
          aoFechar={() => setWhatsapp(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Depois de assinar: o que o profissional costuma fazer em seguida, sem sair da tela. Marcar a
 * próxima sessão (ou ver que ela já está marcada) e chamar o próximo paciente do dia.
 */
function ProximoPasso({
  sessao,
  proximo,
  aoChamarProximo,
  agora,
  fuso,
  hora,
}: {
  sessao: SessaoDoMeuDia;
  proximo: SessaoDoMeuDia | null;
  aoChamarProximo: (id: string) => void;
  agora: Date;
  fuso: string;
  hora: (iso: string) => string;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const [marcando, setMarcando] = React.useState(false);
  const paciente = sessao.paciente;
  // A janela de busca é lida uma vez: o painel é montado por sessão.
  const [janela] = React.useState(() => {
    const de = new Date();
    const ate = new Date(de.getTime() + 60 * 24 * 60 * 60 * 1000);
    return { de: de.toISOString(), ate: ate.toISOString() };
  });

  const futuras = useQuery({
    // Começa com "agenda": marcar por qualquer tela invalida esta lista também.
    queryKey: ["agenda", "do-paciente", paciente?.id ?? "", janela.de],
    queryFn: async () =>
      (
        await apiClient.get<{ data: CompromissoFuturo[] }>(
          `/api/v1/agenda/agendamentos?contact_id=${encodeURIComponent(paciente!.id)}&de=${encodeURIComponent(janela.de)}&ate=${encodeURIComponent(janela.ate)}`,
        )
      ).data,
    enabled: Boolean(paciente),
    retry: false,
  });
  const marcada = proximaJaMarcada(futuras.data ?? [], sessao.id, agora);
  const quando = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: fuso,
    }).format(new Date(iso));

  const textoDaMarcada = (iso: string) =>
    t("Próxima sessão já marcada: {quando}.").replace("{quando}", quando(iso));

  return (
    <Card className="flex flex-col gap-4 p-4" role="status" data-testid="evolucao-assinada">
      <div>
        <h3 className="font-semibold">{t("A evolução desta sessão está assinada.")}</h3>
        <p className="text-sm text-text-muted">{t("Qual o próximo passo?")}</p>
      </div>

      <div className="flex flex-col gap-2" data-testid="proxima-sessao">
        {futuras.isLoading ? (
          <p className="text-sm text-text-muted">{t("Carregando…")}</p>
        ) : marcada ? (
          <p className="text-sm first-letter:uppercase" data-testid="proxima-ja-marcada">
            {textoDaMarcada(marcada.iniciaEm)}
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            {t("Este paciente ainda não tem a próxima sessão marcada.")}
          </p>
        )}
        {paciente && sessao.tipo ? (
          <div>
            <Button
              size="lg"
              variant={marcada ? "outline" : "primary"}
              onClick={() => setMarcando(true)}
              data-testid="marcar-proxima"
            >
              {marcada ? t("Marcar outra sessão") : t("Marcar a próxima sessão")}
            </Button>
          </div>
        ) : null}
      </div>

      {proximo ? (
        <div className="border-t border-border pt-3">
          <Button
            variant="ghost"
            onClick={() => aoChamarProximo(proximo.id)}
            data-testid="chamar-proximo"
            className="h-auto justify-start px-2 py-1.5 text-left"
          >
            {t("Próximo paciente: {nome}, às {hora}")
              .replace("{nome}", proximo.paciente?.nome ?? proximo.titulo)
              .replace("{hora}", hora(proximo.inicio))}
          </Button>
        </div>
      ) : null}

      {marcando ? (
        <JanelaProximaSessao
          sessao={sessao}
          fuso={fuso}
          aberta
          diasAteASugerida={DIAS_ATE_A_PROXIMA_SUGERIDA}
          aoFechar={() => setMarcando(false)}
        />
      ) : null}
    </Card>
  );
}
