"use client";

/**
 * A FOLHA DE UMA SESSÃO: tudo o que se faz com um horário, num lugar só e um passo por vez.
 *
 * Abre com o botão que faz sentido AGORA (confirmar, registrar realizado ou falta, remarcar) e,
 * embaixo, o resto. Remarcar, cancelar e mandar WhatsApp trocam o conteúdo da própria folha em vez
 * de abrir outra janela por cima. As regras (multa, tolerância) são as mesmas da interface atual
 * (`lib/clinica/balcao.ts`); quem decide de verdade continua sendo o servidor.
 */
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useHorariosLivres } from "@/hooks/agenda/useHorariosLivres";
import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import type { PoliticaDaAgenda, SessaoDaGrade } from "@/lib/clinica/agenda";
import { faltaLiberada, previaDaMulta } from "@/lib/clinica/balcao";
import { ROTULO_DA_MODALIDADE } from "@/lib/clinica/vocabulario";
import { formatCents, moedaServidaOu } from "@/lib/money";
import { momentoDa } from "@/lib/novo/hoje";

import { useNovo } from "./Casca";
import { useRecarregar } from "./dados";
import { FolhaDeEvolucao } from "./FolhaDeEvolucao";
import { Avatar, Folha, PontoDaModalidade, dataLonga, hora, primeiroNome } from "./pecas";

type Passo = "inicio" | "remarcar" | "cancelar" | "whatsapp";

export const SELO_DO_MOMENTO = {
  agora: { rotulo: "Em atendimento", classe: "n-selo-ok" },
  para_fechar: { rotulo: "Falta registrar", classe: "n-selo-alerta" },
  sem_confirmacao: { rotulo: "Sem confirmação", classe: "n-selo-aviso" },
  confirmada: { rotulo: "Confirmado", classe: "n-selo-ok" },
} as const;

const SELO_DO_STATUS: Record<string, { rotulo: string; classe: string }> = {
  completed: { rotulo: "Realizado", classe: "n-selo-neutro" },
  no_show: { rotulo: "Faltou", classe: "n-selo-alerta" },
  cancelled: { rotulo: "Cancelado", classe: "n-selo-neutro" },
};

export function seloDa(sessao: SessaoDaGrade, agora: Date): { rotulo: string; classe: string } {
  const m = momentoDa(sessao, agora);
  if (m === "encerrada") return SELO_DO_STATUS[sessao.status] ?? SELO_DO_STATUS.completed!;
  return SELO_DO_MOMENTO[m];
}

export function FolhaDaSessao({
  sessao,
  politica,
  precoCents,
  nomeDoProfissional,
  aoFechar,
}: {
  sessao: SessaoDaGrade | null;
  politica: PoliticaDaAgenda;
  precoCents: number | null;
  nomeDoProfissional: string | null;
  aoFechar: () => void;
}) {
  const { fuso, role, eu } = useNovo();
  const [passo, setPasso] = React.useState<Passo>("inicio");
  const [evolucao, setEvolucao] = React.useState(false);
  const recarregar = useRecarregar();

  const desfecho = useMutation({
    mutationFn: async (status: "confirmed" | "completed" | "no_show") =>
      apiClient.patch("/api/v1/agenda/agendamentos", { id: sessao!.id, status }),
    onSuccess: (_r, status) => {
      toast.success(
        status === "confirmed"
          ? "Presença confirmada."
          : status === "completed"
            ? "Sessão registrada como realizada."
            : "Falta registrada. O horário ficou livre.",
      );
      recarregar();
      aoFechar();
    },
    onError: (err) => showApiError(err),
  });

  if (!sessao) return null;

  const agora = new Date();
  const momento = momentoDa(sessao, agora);
  const nome = sessao.paciente?.nome ?? sessao.titulo;
  const aberta = momento !== "encerrada";
  const podeFaltar = faltaLiberada(sessao, agora);
  const recepcao = role !== "viewer";
  const profissional = eu?.profissional ?? null;
  const selo = seloDa(sessao, agora);

  const titulo =
    passo === "remarcar"
      ? `Remarcar ${primeiroNome(nome)}`
      : passo === "cancelar"
        ? `Cancelar a sessão`
        : passo === "whatsapp"
          ? `Mensagem para ${primeiroNome(nome)}`
          : nome;

  return (
    <>
      <Folha
        aberta={!evolucao}
        aoFechar={aoFechar}
        titulo={titulo}
        subtitulo={
          passo === "inicio"
            ? undefined
            : `${hora(sessao.inicio, fuso)} · ${sessao.tipo?.nome ?? sessao.titulo}`
        }
        testid="novo-folha-sessao"
      >
        {passo === "inicio" && (
          <div className="grid gap-5">
            <div className="flex items-center gap-4 rounded-[20px] bg-[var(--n-papel)] p-4">
              <div className="text-center">
                <p className="n-titulo n-numero text-[34px] leading-none">
                  {hora(sessao.inicio, fuso)}
                </p>
                <p className="n-fraco mt-1 text-xs">até {hora(sessao.fim, fuso)}</p>
              </div>
              <div className="h-12 w-px bg-[var(--n-linha)]" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">
                  <PontoDaModalidade modalidade={sessao.modalidade} />
                  {sessao.tipo?.nome ??
                    (sessao.modalidade ? ROTULO_DA_MODALIDADE[sessao.modalidade] : sessao.titulo)}
                </p>
                <p className="n-suave mt-0.5 truncate text-sm">
                  {nomeDoProfissional ? `com ${nomeDoProfissional}` : "Sem profissional"} ·{" "}
                  {dataLonga(sessao.inicio, fuso)}
                </p>
              </div>
            </div>
            <div>
              <span className={`n-selo ${selo.classe}`}>{selo.rotulo}</span>
            </div>

            {aberta && recepcao && (
              <div className="grid gap-2">
                {momento === "sem_confirmacao" && (
                  <button
                    type="button"
                    className="n-botao n-botao-principal w-full"
                    disabled={desfecho.isPending}
                    onClick={() => desfecho.mutate("confirmed")}
                  >
                    Confirmar presença
                  </button>
                )}
                {(momento === "agora" || momento === "para_fechar") && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="n-botao n-botao-principal"
                      disabled={desfecho.isPending}
                      onClick={() => desfecho.mutate("completed")}
                    >
                      Realizado
                    </button>
                    <button
                      type="button"
                      className="n-botao n-botao-perigo"
                      disabled={desfecho.isPending || !podeFaltar}
                      onClick={() => desfecho.mutate("no_show")}
                      title={
                        podeFaltar
                          ? undefined
                          : `A tolerância de ${politica.tolerancia_atraso_minutos} min ainda não passou`
                      }
                    >
                      Faltou
                    </button>
                  </div>
                )}
                {(momento === "agora" || momento === "para_fechar") &&
                  !podeFaltar &&
                  sessao.falta_liberada_em && (
                    <p className="n-fraco text-center text-xs">
                      A falta pode ser registrada a partir das{" "}
                      {hora(sessao.falta_liberada_em, fuso)}.
                    </p>
                  )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`n-botao ${momento === "confirmada" ? "n-botao-principal" : "n-botao-suave"}`}
                    onClick={() => setPasso("remarcar")}
                  >
                    Remarcar
                  </button>
                  <button
                    type="button"
                    className="n-botao n-botao-suave"
                    disabled={!sessao.paciente?.telefone}
                    onClick={() => setPasso("whatsapp")}
                  >
                    WhatsApp
                  </button>
                </div>
              </div>
            )}

            <div className="grid gap-1 border-t border-[var(--n-linha)] pt-3">
              {sessao.paciente && (
                <Link
                  href={`/novo/pacientes/${sessao.paciente.id}`}
                  className="n-linha-clicavel items-center gap-3 px-2 py-2.5"
                  onClick={aoFechar}
                >
                  <Avatar nome={nome} tamanho={32} />
                  <span className="flex-1 font-semibold">
                    Abrir a ficha de {primeiroNome(nome)}
                  </span>
                  <span className="n-fraco">›</span>
                </Link>
              )}
              {profissional && sessao.paciente && sessao.modalidade && (
                <button
                  type="button"
                  className="n-linha-clicavel items-center gap-3 px-2 py-2.5"
                  onClick={() => setEvolucao(true)}
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--n-acao-suave)] text-[var(--n-acao)]">
                    ✎
                  </span>
                  <span className="flex-1 font-semibold">Escrever a evolução</span>
                  <span className="n-fraco">›</span>
                </button>
              )}
              {aberta && recepcao && (
                <button
                  type="button"
                  className="n-linha-clicavel px-2 py-2.5 text-sm font-semibold text-[var(--n-alerta)]"
                  onClick={() => setPasso("cancelar")}
                >
                  Cancelar a sessão
                </button>
              )}
            </div>
          </div>
        )}

        {passo === "remarcar" && (
          <PassoRemarcar
            sessao={sessao}
            aoVoltar={() => setPasso("inicio")}
            aoConcluir={aoFechar}
          />
        )}
        {passo === "cancelar" && (
          <PassoCancelar
            sessao={sessao}
            politica={politica}
            precoCents={precoCents}
            aoVoltar={() => setPasso("inicio")}
            aoConcluir={aoFechar}
          />
        )}
        {passo === "whatsapp" && (
          <PassoWhatsApp
            sessao={sessao}
            nomeDoProfissional={nomeDoProfissional}
            aoVoltar={() => setPasso("inicio")}
            aoConcluir={aoFechar}
          />
        )}
      </Folha>
      {evolucao && sessao.paciente && sessao.modalidade && (
        <FolhaDeEvolucao
          contactId={sessao.paciente.id}
          nomeDoPaciente={nome}
          appointmentId={sessao.id}
          modalidadeSugerida={sessao.modalidade}
          aoFechar={() => {
            setEvolucao(false);
            aoFechar();
          }}
        />
      )}
    </>
  );
}

function Voltar({ aoVoltar }: { aoVoltar: () => void }) {
  return (
    <button type="button" className="n-botao n-botao-suave" onClick={aoVoltar}>
      Voltar
    </button>
  );
}

function PassoRemarcar({
  sessao,
  aoVoltar,
  aoConcluir,
}: {
  sessao: SessaoDaGrade;
  aoVoltar: () => void;
  aoConcluir: () => void;
}) {
  const { fuso } = useNovo();
  const recarregar = useRecarregar();
  const dias = React.useMemo(() => {
    const hoje = partesNoFuso(new Date(), fuso);
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + i, 12));
      return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
    });
  }, [fuso]);
  const [indice, setIndice] = React.useState(0);
  const [slot, setSlot] = React.useState<string | null>(null);
  const dia = dias[indice]!;
  const filtro = React.useMemo(() => {
    if (!sessao.tipo) return null;
    const seguinte = new Date(Date.UTC(dia.ano, dia.mes - 1, dia.dia + 1, 12));
    return {
      event_type_id: sessao.tipo.id,
      ...(sessao.profissional_user_id ? { owner_user_id: sessao.profissional_user_id } : {}),
      de: instanteDe({ ...dia }, fuso).toISOString(),
      ate: instanteDe(
        {
          ano: seguinte.getUTCFullYear(),
          mes: seguinte.getUTCMonth() + 1,
          dia: seguinte.getUTCDate(),
        },
        fuso,
      ).toISOString(),
    };
  }, [sessao.tipo, sessao.profissional_user_id, dia, fuso]);
  const livres = useHorariosLivres(filtro);
  const [agora] = React.useState(() => Date.now());
  const slots = (livres.data?.slots ?? []).filter((s) => new Date(s.inicio).getTime() > agora);

  const remarcar = useMutation({
    mutationFn: async () =>
      apiClient.patch("/api/v1/agenda/agendamentos", { id: sessao.id, starts_at: slot }),
    onSuccess: () => {
      toast.success(`Remarcado para ${dataLonga(slot!, fuso)}, ${hora(slot!, fuso)}.`);
      recarregar();
      aoConcluir();
    },
    onError: (err) => showApiError(err),
  });

  const rotuloDoDia = (d: (typeof dias)[number], i: number) => {
    if (i === 0) return { cima: "Hoje", baixo: String(d.dia) };
    if (i === 1) return { cima: "Amanhã", baixo: String(d.dia) };
    const data = new Date(Date.UTC(d.ano, d.mes - 1, d.dia, 12));
    return {
      cima: new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })
        .format(data)
        .replace(".", ""),
      baixo: String(d.dia),
    };
  };

  return (
    <div className="grid gap-5">
      {!sessao.tipo ? (
        <p className="n-suave text-sm">
          Esse horário não tem tipo de atendimento, então não dá para buscar horários livres por
          aqui.
        </p>
      ) : (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Dia">
            {dias.map((d, i) => {
              const r = rotuloDoDia(d, i);
              return (
                <button
                  key={`${d.mes}-${d.dia}`}
                  type="button"
                  aria-pressed={i === indice}
                  onClick={() => {
                    setIndice(i);
                    setSlot(null);
                  }}
                  className={`flex min-w-[58px] flex-col items-center rounded-2xl px-2 py-2 text-xs font-semibold ${
                    i === indice
                      ? "bg-[var(--n-tinta)] text-[var(--n-papel)]"
                      : "bg-[var(--n-papel)]"
                  }`}
                >
                  <span className="capitalize opacity-75">{r.cima}</span>
                  <span className="n-titulo n-numero text-xl">{r.baixo}</span>
                </button>
              );
            })}
          </div>
          <div>
            <p className="n-rotulo">Horários livres</p>
            {livres.isLoading ? (
              <p className="n-fraco text-sm">Procurando…</p>
            ) : slots.length === 0 ? (
              <p className="n-suave text-sm">Nenhum horário livre neste dia. Tente outro.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2" data-testid="novo-horarios-livres">
                {slots.map((s) => (
                  <button
                    key={s.inicio}
                    type="button"
                    aria-pressed={slot === s.inicio}
                    onClick={() => setSlot(s.inicio)}
                    className={`n-numero rounded-xl py-2.5 text-sm font-semibold ${
                      slot === s.inicio
                        ? "bg-[var(--n-acao)] text-[var(--n-acao-tinta)]"
                        : "bg-[var(--n-papel)]"
                    }`}
                  >
                    {hora(s.inicio, fuso)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Voltar aoVoltar={aoVoltar} />
        <button
          type="button"
          className="n-botao n-botao-principal"
          disabled={!slot || remarcar.isPending}
          onClick={() => remarcar.mutate()}
        >
          {slot ? `Remarcar para ${hora(slot, fuso)}` : "Escolha um horário"}
        </button>
      </div>
    </div>
  );
}

function PassoCancelar({
  sessao,
  politica,
  precoCents,
  aoVoltar,
  aoConcluir,
}: {
  sessao: SessaoDaGrade;
  politica: PoliticaDaAgenda;
  precoCents: number | null;
  aoVoltar: () => void;
  aoConcluir: () => void;
}) {
  const moeda = moedaServidaOu(useActiveOrg()?.currency);
  const recarregar = useRecarregar();
  const [pelaClinica, setPelaClinica] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const previa = previaDaMulta({ sessao, agora: new Date(), politica, precoCents, pelaClinica });

  const cancelar = useMutation({
    mutationFn: async () =>
      apiClient.post<{
        data: { multa: { valor_cents: number | null; percentual: number } | null };
      }>(`/api/v1/clinica/agenda/${sessao.id}/cancelar`, {
        motivo: motivo.trim(),
        pela_clinica: pelaClinica,
      }),
    onSuccess: (r) => {
      const multa = r.data.multa;
      toast.success(
        multa
          ? `Sessão cancelada. Multa de ${
              multa.valor_cents != null
                ? formatCents(multa.valor_cents, moeda)
                : `${multa.percentual}%`
            } lançada.`
          : "Sessão cancelada sem custo.",
      );
      recarregar();
      aoConcluir();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <div className="grid gap-5">
      <div>
        <p className="n-rotulo">Quem pediu?</p>
        <div className="grid grid-cols-2 gap-2">
          {[false, true].map((clinica) => (
            <button
              key={String(clinica)}
              type="button"
              aria-pressed={pelaClinica === clinica}
              onClick={() => setPelaClinica(clinica)}
              className={`n-botao ${pelaClinica === clinica ? "n-botao-escuro" : "n-botao-suave"}`}
            >
              {clinica ? "A clínica" : "O paciente"}
            </button>
          ))}
        </div>
      </div>
      <div
        data-testid="novo-previa-da-multa"
        className={`rounded-2xl p-4 text-sm ${previa ? "bg-[var(--n-aviso-suave)] text-[var(--n-aviso)]" : "bg-[var(--n-ok-suave)] text-[var(--n-ok)]"}`}
      >
        {previa ? (
          <>
            <p className="n-titulo text-2xl">
              Multa de{" "}
              {previa.valor_cents != null
                ? formatCents(previa.valor_cents, moeda)
                : `${previa.percentual}%`}
            </p>
            <p className="mt-1">
              Faltam menos de {politica.antecedencia_cancelamento_horas} horas para a sessão. A
              multa é cobrada no próximo pagamento e pode ser isentada depois.
            </p>
          </>
        ) : (
          <p className="font-semibold">
            {pelaClinica
              ? "A clínica desmarcou: sem custo para o paciente."
              : "Dentro do prazo: sem multa."}
          </p>
        )}
      </div>
      <label className="block">
        <span className="n-rotulo">Motivo</span>
        <textarea
          className="n-campo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ex.: paciente com febre, pediu para remarcar na semana que vem"
        />
      </label>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Voltar aoVoltar={aoVoltar} />
        <button
          type="button"
          className="n-botao n-botao-perigo"
          disabled={motivo.trim().length < 3 || cancelar.isPending}
          onClick={() => cancelar.mutate()}
        >
          Cancelar a sessão
        </button>
      </div>
    </div>
  );
}

function PassoWhatsApp({
  sessao,
  nomeDoProfissional,
  aoVoltar,
  aoConcluir,
}: {
  sessao: SessaoDaGrade;
  nomeDoProfissional: string | null;
  aoVoltar: () => void;
  aoConcluir: () => void;
}) {
  const { fuso } = useNovo();
  const nome = primeiroNome(sessao.paciente?.nome ?? "");
  const h = hora(sessao.inicio, fuso);
  const tipo = (sessao.tipo?.nome ?? "sessão").toLowerCase();
  const com = nomeDoProfissional ? ` com ${primeiroNome(nomeDoProfissional)}` : "";
  const modelos = [
    {
      rotulo: "Lembrar",
      texto: `Oi, ${nome}! Passando para lembrar da sua ${tipo}${com} às ${h}. Podemos confirmar?`,
    },
    { rotulo: "Estamos esperando", texto: `Oi, ${nome}! Estamos te esperando. Está a caminho?` },
    {
      rotulo: "Remarcar",
      texto: `Oi, ${nome}! Precisamos remarcar sua ${tipo} das ${h}. Qual horário fica bom para você?`,
    },
  ];
  const [texto, setTexto] = React.useState(modelos[0]!.texto);
  const enviar = useMutation({
    mutationFn: async () => {
      const conversa = await apiClient.post<{ data: { conversation_id: string } }>(
        "/api/v1/conversations/open-with-contact",
        { contact_id: sessao.paciente!.id, phone_number: sessao.paciente!.telefone },
      );
      return apiClient.post("/api/v1/messages", {
        conversation_id: conversa.data.conversation_id,
        body: texto.trim(),
      });
    },
    onSuccess: () => {
      toast.success(`Mensagem enviada para ${nome}.`);
      aoConcluir();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {modelos.map((m) => (
          <button
            key={m.rotulo}
            type="button"
            className="n-chip"
            aria-pressed={texto === m.texto}
            onClick={() => setTexto(m.texto)}
          >
            {m.rotulo}
          </button>
        ))}
      </div>
      <textarea
        className="n-campo"
        rows={5}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        aria-label="Mensagem"
      />
      <p className="n-fraco text-xs">Sai pelo número da clínica e fica na conversa do paciente.</p>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Voltar aoVoltar={aoVoltar} />
        <button
          type="button"
          className="n-botao n-botao-principal"
          disabled={!texto.trim() || enviar.isPending}
          onClick={() => enviar.mutate()}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
