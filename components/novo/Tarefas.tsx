"use client";

/**
 * TAREFAS na interface nova: a lista (agrupada por prazo), a folha de criar e editar, e o cartão
 * de tarefas na ficha do paciente. Mesmas rotas e mesma regra da versão atual (`/api/v1/tasks`,
 * `lib/tarefas/tipos.ts`): "Somente leitura" vê, quem atende para cima cria e edita.
 *
 * O que muda é a pergunta da clínica: a tarefa pode ficar presa a um paciente ("ligar para a Ana
 * sobre o exame"), e aí aparece na ficha dele também.
 *
 * E toda tarefa tem um RESPONSÁVEL: alguém da equipe que vai resolvê-la. Nasce com quem criou,
 * qualquer pessoa da equipe pode passá-la para outra (`PATCH assigned_to`), e cada repasse fica
 * registrado (`GET /api/v1/tasks/[id]/repasses`). A lista e o calendário filtram "Minhas".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useAssignableMembers } from "@/hooks/inbox/useAssignableMembers";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { andar, diaDaSemana, diasDaVisao } from "@/lib/novo/agenda";
import {
  agrupaPorPrazo,
  diaLocalDoPrazo,
  estaAtrasada,
  estaEncerrada,
  type FaixaDePrazo,
  type NovaTarefa,
  type PrioridadeDaTarefa,
  type SituacaoDaTarefa,
  type Tarefa,
} from "@/lib/tarefas/tipos";
import type { RepasseDaTarefa } from "@/lib/tarefas/responsavel";

import { useNovo } from "./Casca";
import { useBuscaDePacientes, usePaciente } from "./dados";
import { Avatar, Folha, Vazio } from "./pecas";

const CHAVE = ["crm_tasks"] as const;

export function useTarefasDaClinica(
  filtro: { aberto?: boolean; contactId?: string; responsavel?: string } = {},
) {
  const qs = new URLSearchParams();
  if (filtro.aberto) qs.set("aberto", "true");
  if (filtro.contactId) qs.set("contact_id", filtro.contactId);
  if (filtro.responsavel) qs.set("assigned_to", filtro.responsavel);
  const s = qs.toString();
  return useQuery({
    queryKey: [...CHAVE, s],
    queryFn: async () =>
      (await apiClient.get<{ data: { tasks: Tarefa[] } }>(`/api/v1/tasks${s ? `?${s}` : ""}`)).data
        .tasks,
    staleTime: 10_000,
    retry: false,
  });
}

/**
 * Quem pode ser responsável (membros ativos que atendem, `/api/v1/team/assignable`), e o nome de
 * cada um para as linhas. Quem saiu da equipe some da lista; a tarefa que ficou com ele mostra
 * "Ex-membro da equipe" até alguém passá-la adiante.
 */
function useEquipeDasTarefas() {
  const membros = useAssignableMembers(true);
  const lista = (membros.data ?? []).map((m) => ({
    id: m.user_id,
    nome: m.full_name?.trim() || null,
  }));
  const nomes = new Map(lista.map((m) => [m.id, m.nome]));
  return { lista, nomes, carregando: membros.isLoading };
}

function useNomeDoMembro() {
  const t = useT();
  const { meuId } = useNovo();
  const { nomes, carregando } = useEquipeDasTarefas();
  return (id: string | null): string => {
    if (!id) return t("Sem responsável");
    const nome = nomes.get(id);
    if (nome) return id === meuId ? `${nome} (${t("você")})` : nome;
    if (id === meuId) return t("Você");
    if (carregando) return "…";
    return nomes.has(id) ? t("Membro da equipe") : t("Ex-membro da equipe");
  };
}

function useInvalidarTarefas() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: CHAVE });
}

export const ROTULO_DA_FAIXA: Record<FaixaDePrazo, string> = {
  atrasada: "Atrasadas",
  hoje: "Hoje",
  esta_semana: "Nos próximos 7 dias",
  mais_tarde: "Mais para frente",
  sem_prazo: "Sem prazo",
  encerrada: "Encerradas",
};

const ROTULO_DA_PRIORIDADE: Record<PrioridadeDaTarefa, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

const ROTULO_DA_SITUACAO: Record<SituacaoDaTarefa, string> = {
  pending: "Pendente",
  in_progress: "Em andamento",
  done: "Concluída",
  cancelled: "Cancelada",
};

/** "hoje às 14:00", "qui., 9 de out. às 9:00" — no fuso de quem olha, como a versão atual. */
function prazoLegivel(iso: string, tag: string, t: (s: string) => string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const horario = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit" }).format(d);
  const dia = mesmoDia
    ? t("hoje")
    : new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${dia} ${t("às")} ${horario}`;
}

/** Uma linha da lista: marcar como feita, abrir para editar, e o paciente quando houver. */
function LinhaDaTarefa({
  tarefa,
  podeEditar,
  aoAbrir,
  mostrarPaciente = true,
}: {
  tarefa: Tarefa;
  podeEditar: boolean;
  aoAbrir: (t: Tarefa) => void;
  mostrarPaciente?: boolean;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const invalidar = useInvalidarTarefas();
  const nomeDoMembro = useNomeDoMembro();
  const feita = tarefa.status === "done";
  const encerrada = estaEncerrada(tarefa);
  const atrasada = estaAtrasada(tarefa);
  const alternar = useMutation({
    mutationFn: async () =>
      apiClient.patch(`/api/v1/tasks/${encodeURIComponent(tarefa.id)}`, {
        status: feita ? "pending" : "done",
      }),
    onSuccess: () => {
      if (!feita) toast.success(t("Tarefa concluída."));
      invalidar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <li className="flex items-start gap-3 py-3" data-testid="novo-tarefa">
      <input
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-[var(--n-acao)]"
        // Otimista: o visto aparece no clique, sem esperar a lista voltar do servidor.
        checked={alternar.isPending ? !feita : feita}
        disabled={!podeEditar || alternar.isPending || tarefa.status === "cancelled"}
        onChange={() => alternar.mutate()}
        aria-label={feita ? t("Reabrir tarefa") : t("Marcar como feita")}
        data-testid="novo-concluir-tarefa"
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => aoAbrir(tarefa)}
        disabled={!podeEditar}
      >
        <span
          className={`block text-[15px] font-semibold ${encerrada ? "n-fraco line-through" : ""}`}
        >
          {tarefa.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {tarefa.due_date && (
            <span className={atrasada ? "font-bold text-[var(--n-alerta)]" : "n-suave"}>
              {prazoLegivel(tarefa.due_date, tag, t)}
            </span>
          )}
          {(tarefa.priority === "high" || tarefa.priority === "urgent") && !encerrada && (
            <span
              className={`n-selo ${tarefa.priority === "urgent" ? "n-selo-alerta" : "n-selo-aviso"}`}
            >
              {t(ROTULO_DA_PRIORIDADE[tarefa.priority])}
            </span>
          )}
          {tarefa.status === "in_progress" && (
            <span className="n-selo n-selo-neutro">{t("Em andamento")}</span>
          )}
          {tarefa.status === "cancelled" && (
            <span className="n-selo n-selo-neutro">{t("Cancelada")}</span>
          )}
          <span
            className={`inline-flex min-w-0 items-center gap-1 ${
              tarefa.assigned_to ? "n-suave" : "font-bold text-[var(--n-alerta)]"
            }`}
            data-testid="novo-tarefa-responsavel"
          >
            {tarefa.assigned_to && <Avatar nome={nomeDoMembro(tarefa.assigned_to)} tamanho={16} />}
            <span className="truncate">{nomeDoMembro(tarefa.assigned_to)}</span>
          </span>
        </span>
        {tarefa.description && (
          <span className="n-suave mt-1 line-clamp-2 block text-sm">{tarefa.description}</span>
        )}
      </button>
      {mostrarPaciente && tarefa.contact_id && <PacienteDaTarefa contactId={tarefa.contact_id} />}
    </li>
  );
}

function PacienteDaTarefa({ contactId }: { contactId: string }) {
  const t = useT();
  const paciente = usePaciente(contactId);
  if (!paciente.data) return null;
  const nome = rotuloDoContato(paciente.data, t);
  return (
    <Link
      href={`/pacientes/${contactId}`}
      className="n-botao n-botao-suave n-botao-pequeno max-w-[40%] shrink-0 gap-2"
      title={nome}
    >
      <Avatar nome={nome} tamanho={20} />
      <span className="truncate">{nome}</span>
    </Link>
  );
}

/** A TELA de tarefas. */
export function TelaDeTarefas() {
  const t = useT();
  const { role, meuId } = useNovo();
  const podeEditar = role !== "viewer";
  const [filtro, setFiltro] = React.useState<"aberto" | "todas">("aberto");
  const [quem, setQuem] = React.useState<"minhas" | "equipe">("equipe");
  const tarefas = useTarefasDaClinica({
    aberto: filtro === "aberto",
    responsavel: quem === "minhas" ? meuId : undefined,
  });
  const [aberta, setAberta] = React.useState<Tarefa | "nova" | null>(null);
  const [novaNoDia, setNovaNoDia] = React.useState<string | null>(null);
  const [modo, setModo] = React.useState<"lista" | "calendario">("lista");
  const grupos = agrupaPorPrazo(tarefas.data ?? []);

  return (
    <div className="n-conteudo max-w-3xl" data-testid="novo-tarefas">
      <div className="n-entra flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">{t("Tarefas")}</h1>
          <p className="n-suave mt-1">
            {t("O que ficou combinado, com prazo. Presa a um paciente, aparece na ficha dele.")}
          </p>
        </div>
        {podeEditar && (
          <button
            type="button"
            className="n-botao n-botao-principal"
            onClick={() => setAberta("nova")}
            data-testid="novo-nova-tarefa"
          >
            + {t("Nova tarefa")}
          </button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <div className="flex gap-2" role="group" aria-label={t("Como ver as tarefas")}>
          <button
            type="button"
            className="n-chip"
            aria-pressed={modo === "lista"}
            onClick={() => setModo("lista")}
            data-testid="novo-tarefas-lista"
          >
            {t("Lista")}
          </button>
          <button
            type="button"
            className="n-chip"
            aria-pressed={modo === "calendario"}
            onClick={() => setModo("calendario")}
            data-testid="novo-tarefas-calendario"
          >
            {t("Calendário")}
          </button>
        </div>
        <span className="w-px self-stretch bg-[var(--n-linha)]" aria-hidden />
        <div className="flex gap-2" role="group" aria-label={t("De quem")}>
          <button
            type="button"
            className="n-chip"
            aria-pressed={quem === "minhas"}
            onClick={() => setQuem("minhas")}
            data-testid="novo-tarefas-minhas"
          >
            {t("Minhas tarefas")}
          </button>
          <button
            type="button"
            className="n-chip"
            aria-pressed={quem === "equipe"}
            onClick={() => setQuem("equipe")}
            data-testid="novo-tarefas-da-equipe"
          >
            {t("Da equipe")}
          </button>
        </div>
        <span className="w-px self-stretch bg-[var(--n-linha)]" aria-hidden />
        <div className="flex gap-2" role="group" aria-label={t("Quais tarefas")}>
          <button
            type="button"
            className="n-chip"
            aria-pressed={filtro === "aberto"}
            onClick={() => setFiltro("aberto")}
          >
            {t("Em aberto")}
          </button>
          <button
            type="button"
            className="n-chip"
            aria-pressed={filtro === "todas"}
            onClick={() => setFiltro("todas")}
          >
            {t("Todas")}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-6">
        {tarefas.isLoading ? (
          <div className="n-cartao h-40 animate-pulse" />
        ) : tarefas.error ? (
          <Vazio titulo={t("Não foi possível carregar as tarefas.")} />
        ) : modo === "calendario" ? (
          <CalendarioDasTarefas
            tarefas={tarefas.data ?? []}
            podeEditar={podeEditar}
            aoAbrir={setAberta}
            aoCriarNoDia={setNovaNoDia}
          />
        ) : grupos.length === 0 ? (
          <Vazio
            titulo={quem === "minhas" ? t("Nada com você") : t("Nada pendente")}
            texto={
              quem === "minhas"
                ? t("As tarefas que passarem para você aparecem aqui.")
                : t("Quando algo ficar combinado (ligar de volta, pedir um exame), anote aqui.")
            }
          />
        ) : (
          grupos.map((g) => (
            <section
              key={g.faixa}
              className="n-cartao px-5 py-2"
              data-testid={`novo-faixa-${g.faixa}`}
            >
              <h2
                className={`flex items-center gap-2 pt-3 text-[15px] font-bold ${
                  g.faixa === "atrasada" ? "text-[var(--n-alerta)]" : ""
                }`}
              >
                {t(ROTULO_DA_FAIXA[g.faixa])}
                <span className="n-fraco n-numero font-semibold">{g.tarefas.length}</span>
              </h2>
              <ul className="divide-y divide-[var(--n-linha)]">
                {g.tarefas.map((x) => (
                  <LinhaDaTarefa
                    key={x.id}
                    tarefa={x}
                    podeEditar={podeEditar}
                    aoAbrir={setAberta}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {aberta && (
        <FolhaDaTarefa
          tarefa={aberta === "nova" ? null : aberta}
          aoFechar={() => setAberta(null)}
        />
      )}
      {novaNoDia && (
        <FolhaDaTarefa tarefa={null} diaInicial={novaNoDia} aoFechar={() => setNovaNoDia(null)} />
      )}
    </div>
  );
}

const TAREFAS_NO_DIA = 3;

/**
 * O mês, com o que vence em cada dia, como o Calendário de Tarefas da versão atual: tocar na
 * tarefa abre a folha dela; tocar no dia (quem edita) abre uma tarefa nova já com esse prazo.
 */
function CalendarioDasTarefas({
  tarefas,
  podeEditar,
  aoAbrir,
  aoCriarNoDia,
}: {
  tarefas: Tarefa[];
  podeEditar: boolean;
  aoAbrir: (t: Tarefa) => void;
  aoCriarNoDia: (dia: string) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const hoje = diaLocalDoPrazo(new Date().toISOString());
  const [mes, setMes] = React.useState(`${hoje.slice(0, 8)}01`);
  const dias = diasDaVisao("mes", mes);
  const porDia = new Map<string, Tarefa[]>();
  for (const x of tarefas) {
    if (!x.due_date) continue;
    const d = diaLocalDoPrazo(x.due_date);
    porDia.set(d, [...(porDia.get(d) ?? []), x]);
  }
  const semPrazo = tarefas.filter((x) => !x.due_date).length;
  // 5 de outubro de 2026 é uma segunda: os nomes dos dias saem dela, no idioma da pessoa.
  const nomes = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2026, 9, 5 + i, 12)))
      .replace(".", ""),
  );
  const nomeDoMes = new Intl.DateTimeFormat(tag, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${mes}T12:00:00Z`));
  return (
    <section data-testid="novo-tarefas-mes">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className="n-botao n-botao-suave n-botao-pequeno"
          aria-label={t("Mês anterior")}
          onClick={() => setMes((m) => andar("mes", m, -1))}
        >
          ‹
        </button>
        <h2 className="n-inicial flex-1 text-center text-[15px] font-bold">{nomeDoMes}</h2>
        <button
          type="button"
          className="n-botao n-botao-suave n-botao-pequeno"
          aria-label={t("Próximo mês")}
          onClick={() => setMes((m) => andar("mes", m, 1))}
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {nomes.map((n) => (
          <p key={n} className="n-fraco n-inicial pb-1 text-center text-xs font-bold">
            {n}
          </p>
        ))}
        {Array.from({ length: diaDaSemana(dias[0]!) }, (_, i) => (
          <div key={`vazio-${i}`} aria-hidden />
        ))}
        {dias.map((d) => {
          const doDia = porDia.get(d) ?? [];
          const atrasadas = doDia.some((x) => estaAtrasada(x));
          return (
            <div
              key={d}
              className={`n-cartao flex min-h-[64px] min-w-0 flex-col gap-0.5 p-1.5 sm:min-h-[96px] ${
                d === hoje ? "ring-2 ring-[var(--n-acao)]" : ""
              }`}
              data-testid="novo-tarefas-dia"
            >
              <button
                type="button"
                disabled={!podeEditar}
                onClick={() => aoCriarNoDia(d)}
                className="flex items-center justify-between text-left disabled:cursor-default"
                aria-label={`${t("Nova tarefa")} · ${new Intl.DateTimeFormat(tag, {
                  day: "numeric",
                  month: "long",
                  timeZone: "UTC",
                }).format(new Date(`${d}T12:00:00Z`))}`}
              >
                <span
                  className={`n-numero text-sm font-bold ${d === hoje ? "text-[var(--n-acao)]" : ""}`}
                >
                  {Number(d.slice(8))}
                </span>
                {doDia.length > 0 && (
                  <span className="sm:hidden">
                    <span
                      className={`n-selo px-1.5 text-[10px] ${atrasadas ? "n-selo-alerta" : "n-selo-neutro"}`}
                    >
                      {doDia.length}
                    </span>
                  </span>
                )}
              </button>
              <div className="hidden min-w-0 gap-0.5 sm:grid">
                {doDia.slice(0, TAREFAS_NO_DIA).map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => aoAbrir(x)}
                    className={`truncate rounded-md px-1 py-0.5 text-left text-[11.5px] font-semibold hover:bg-[var(--n-papel)] ${
                      estaEncerrada(x)
                        ? "n-fraco line-through"
                        : estaAtrasada(x)
                          ? "text-[var(--n-alerta)]"
                          : ""
                    }`}
                    data-testid="novo-tarefas-no-dia"
                  >
                    {x.title}
                  </button>
                ))}
                {doDia.length > TAREFAS_NO_DIA && (
                  <span className="n-suave px-1 text-[11px] font-semibold">
                    +{doDia.length - TAREFAS_NO_DIA} {t("mais")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {semPrazo > 0 && (
        <p className="n-suave mt-3 text-sm">
          {semPrazo}{" "}
          {semPrazo === 1
            ? t("tarefa sem prazo fica só na lista.")
            : t("tarefas sem prazo ficam só na lista.")}
        </p>
      )}
    </section>
  );
}

/** O cartão da ficha: as tarefas em aberto deste paciente, com "+ Tarefa" já preso a ele. */
export function CartaoDeTarefas({ contactId, nome }: { contactId: string; nome: string }) {
  const t = useT();
  const { role } = useNovo();
  const podeEditar = role !== "viewer";
  const tarefas = useTarefasDaClinica({ aberto: true, contactId });
  const [aberta, setAberta] = React.useState<Tarefa | "nova" | null>(null);
  const lista = tarefas.data ?? [];
  if (tarefas.error || (lista.length === 0 && !podeEditar)) return null;

  return (
    <section className="n-cartao p-5" data-testid="novo-tarefas-do-paciente">
      <h2 className="mb-1 flex items-center justify-between text-[15px] font-bold">
        {t("Tarefas")}
        {podeEditar && (
          <button
            type="button"
            className="n-botao n-botao-suave n-botao-pequeno"
            onClick={() => setAberta("nova")}
            data-testid="novo-nova-tarefa-do-paciente"
          >
            + {t("Tarefa")}
          </button>
        )}
      </h2>
      {lista.length === 0 ? (
        <p className="n-suave text-sm">{t("Nenhuma tarefa em aberto.")}</p>
      ) : (
        <ul className="divide-y divide-[var(--n-linha)]">
          {lista.slice(0, 5).map((x) => (
            <LinhaDaTarefa
              key={x.id}
              tarefa={x}
              podeEditar={podeEditar}
              aoAbrir={setAberta}
              mostrarPaciente={false}
            />
          ))}
        </ul>
      )}
      {aberta && (
        <FolhaDaTarefa
          tarefa={aberta === "nova" ? null : aberta}
          paciente={{ id: contactId, nome }}
          aoFechar={() => setAberta(null)}
        />
      )}
    </section>
  );
}

function separaPrazo(iso: string | null | undefined): { dia: string; hora: string } {
  if (!iso) return { dia: "", hora: "09:00" };
  const d = new Date(iso);
  const dois = (n: number) => String(n).padStart(2, "0");
  return {
    dia: `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`,
    hora: `${dois(d.getHours())}:${dois(d.getMinutes())}`,
  };
}

/** O registro da tarefa: quem criou, e cada vez que ela passou de uma pessoa para outra. */
function RepassesDaTarefa({ tarefa }: { tarefa: Tarefa }) {
  const t = useT();
  const tag = useTagDeIdioma();
  const nomeDoMembro = useNomeDoMembro();
  const repasses = useQuery({
    queryKey: [...CHAVE, "repasses", tarefa.id, tarefa.updated_at],
    queryFn: async () =>
      (
        await apiClient.get<{ data: { repasses: RepasseDaTarefa[] } }>(
          `/api/v1/tasks/${encodeURIComponent(tarefa.id)}/repasses`,
        )
      ).data.repasses,
    staleTime: 10_000,
    retry: false,
  });
  const quando = (iso: string) =>
    new Intl.DateTimeFormat(tag, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  const lista = repasses.data ?? [];
  return (
    <div className="grid gap-1 text-xs" data-testid="novo-tarefa-repasses">
      {lista.map((r) => (
        <p key={`${r.em}-${r.para}`} className="n-suave">
          {/* Tarefa que estava sem responsável (antiga, ou do sistema) foi "passada para", não "de". */}
          {quando(r.em)} · {nomeDoMembro(r.por)}{" "}
          {r.de ? `${t("passou de")} ${nomeDoMembro(r.de)} ${t("para")}` : t("passou para")}{" "}
          <strong>{nomeDoMembro(r.para)}</strong>
        </p>
      ))}
      <p className="n-fraco">
        {quando(tarefa.created_at)} ·{" "}
        {tarefa.created_by
          ? `${t("Criada por")} ${nomeDoMembro(tarefa.created_by)}`
          : t("Criada pelo sistema")}
      </p>
    </div>
  );
}

/** Montada a cada abertura: o estado nasce da tarefa (ou em branco). */
export function FolhaDaTarefa({
  tarefa,
  paciente: pacienteFixo,
  diaInicial,
  aoFechar,
}: {
  tarefa: Tarefa | null;
  paciente?: { id: string; nome: string };
  /** Tarefa nova aberta pelo dia do calendário: já nasce com esse prazo (`AAAA-MM-DD`). */
  diaInicial?: string;
  aoFechar: () => void;
}) {
  const t = useT();
  const invalidar = useInvalidarTarefas();
  const prazo = separaPrazo(tarefa?.due_date);
  const [titulo, setTitulo] = React.useState(tarefa?.title ?? "");
  const [detalhes, setDetalhes] = React.useState(tarefa?.description ?? "");
  const [dia, setDia] = React.useState(tarefa ? prazo.dia : (diaInicial ?? prazo.dia));
  const [hora, setHora] = React.useState(prazo.hora);
  const [prioridade, setPrioridade] = React.useState<PrioridadeDaTarefa>(
    tarefa?.priority ?? "medium",
  );
  const [situacao, setSituacao] = React.useState<SituacaoDaTarefa>(tarefa?.status ?? "pending");
  const { meuId } = useNovo();
  const equipe = useEquipeDasTarefas();
  const nomeDoMembro = useNomeDoMembro();
  // Tarefa nova nasce com quem cria; a antiga sem responsável (criada antes, ou pelo sistema)
  // pede uma escolha antes de salvar.
  const [responsavel, setResponsavel] = React.useState<string>(
    tarefa ? (tarefa.assigned_to ?? "") : meuId,
  );
  const opcoesDeResponsavel = [
    ...equipe.lista,
    // Quem já tem a tarefa continua na lista mesmo que tenha saído da equipe: senão a escolha
    // gravada some da tela.
    ...(tarefa?.assigned_to && !equipe.nomes.has(tarefa.assigned_to)
      ? [{ id: tarefa.assigned_to, nome: null }]
      : []),
  ].sort((a, b) => (a.id === meuId ? -1 : b.id === meuId ? 1 : 0));
  const [paciente, setPaciente] = React.useState<{ id: string; nome: string } | null>(
    pacienteFixo ?? null,
  );
  const [busca, setBusca] = React.useState("");
  const candidatos = useBuscaDePacientes(busca);
  // Editando: o paciente gravado chega pela ficha; preenche uma vez, durante a renderização.
  const gravado = usePaciente(!pacienteFixo && tarefa?.contact_id ? tarefa.contact_id : "");
  const [preenchido, setPreenchido] = React.useState(false);
  if (!preenchido && gravado.data && tarefa?.contact_id) {
    setPreenchido(true);
    setPaciente({ id: tarefa.contact_id, nome: rotuloDoContato(gravado.data, t) });
  }

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo: NovaTarefa = {
        title: titulo.trim(),
        description: detalhes.trim() || null,
        // Sem dia não há hora que valha (a coluna aceita nulo de propósito, migration 0210).
        due_date: dia ? new Date(`${dia}T${hora || "00:00"}:00`).toISOString() : null,
        priority: prioridade,
        status: situacao,
        contact_id: paciente?.id ?? null,
        assigned_to: responsavel,
      };
      if (tarefa) await apiClient.patch(`/api/v1/tasks/${encodeURIComponent(tarefa.id)}`, corpo);
      else await apiClient.post("/api/v1/tasks", { ...corpo, lead_id: null });
    },
    onSuccess: () => {
      toast.success(tarefa ? t("Tarefa atualizada.") : t("Tarefa criada."));
      invalidar();
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  const apagar = useMutation({
    mutationFn: async () => apiClient.delete(`/api/v1/tasks/${encodeURIComponent(tarefa!.id)}`),
    onSuccess: () => {
      toast.success(t("Tarefa apagada."));
      invalidar();
      aoFechar();
    },
    onError: (e) => showApiError(e),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={tarefa ? t("Editar tarefa") : t("Nova tarefa")}
      subtitulo={pacienteFixo ? pacienteFixo.nome : undefined}
      testid="novo-folha-tarefa"
    >
      <div className="grid gap-5">
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("O que precisa ser feito")}</span>
          <input
            className="n-campo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={t("Ex.: ligar para confirmar o exame")}
            autoFocus
            data-testid="novo-tarefa-titulo"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("Detalhes")}</span>
          <textarea
            className="n-campo min-h-[80px] py-3"
            value={detalhes}
            onChange={(e) => setDetalhes(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Prazo")}</span>
            <input
              type="date"
              className="n-campo"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              data-testid="novo-tarefa-dia"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Horário")}</span>
            <input
              type="time"
              className="n-campo"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              disabled={!dia}
            />
          </label>
        </div>
        <div className="grid gap-1.5">
          <span className="n-rotulo !mb-0">{t("Prioridade")}</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ROTULO_DA_PRIORIDADE) as PrioridadeDaTarefa[]).map((p) => (
              <button
                key={p}
                type="button"
                className="n-chip"
                aria-pressed={prioridade === p}
                onClick={() => setPrioridade(p)}
              >
                {t(ROTULO_DA_PRIORIDADE[p])}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5" role="group" aria-label={t("Responsável")}>
          <span className="n-rotulo !mb-0">{t("Responsável")}</span>
          <span className="n-suave -mt-1 text-xs">
            {t("Quem da equipe vai resolver. Qualquer pessoa pode passar a tarefa para outra.")}
          </span>
          <div className="flex flex-wrap gap-2" data-testid="novo-tarefa-responsaveis">
            {opcoesDeResponsavel.map((m) => (
              <button
                key={m.id}
                type="button"
                className="n-chip gap-1.5"
                aria-pressed={responsavel === m.id}
                onClick={() => setResponsavel(m.id)}
                data-testid="novo-tarefa-responsavel-opcao"
              >
                <Avatar nome={nomeDoMembro(m.id)} tamanho={18} />
                {nomeDoMembro(m.id)}
              </button>
            ))}
          </div>
          {!responsavel && (
            <span className="text-xs font-bold text-[var(--n-alerta)]">
              {t("Escolha quem vai resolver esta tarefa.")}
            </span>
          )}
        </div>
        {tarefa && <RepassesDaTarefa tarefa={tarefa} />}
        {tarefa && (
          <div className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Situação")}</span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROTULO_DA_SITUACAO) as SituacaoDaTarefa[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="n-chip"
                  aria-pressed={situacao === s}
                  onClick={() => setSituacao(s)}
                >
                  {t(ROTULO_DA_SITUACAO[s])}
                </button>
              ))}
            </div>
          </div>
        )}
        {!pacienteFixo && (
          <div className="grid gap-1.5">
            <span className="n-rotulo !mb-0">{t("Paciente (opcional)")}</span>
            {paciente ? (
              <div className="flex items-center gap-3 rounded-2xl bg-[var(--n-papel)] p-3">
                <Avatar nome={paciente.nome} tamanho={32} />
                <span className="flex-1 font-semibold">{paciente.nome}</span>
                <button
                  type="button"
                  className="n-botao n-botao-suave n-botao-pequeno"
                  onClick={() => setPaciente(null)}
                >
                  {t("Tirar")}
                </button>
              </div>
            ) : (
              <>
                <input
                  className="n-campo"
                  placeholder={t("Nome ou telefone do paciente")}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  aria-label={t("Buscar paciente")}
                  data-testid="novo-tarefa-buscar-paciente"
                />
                {busca.trim().length >= 2 && (
                  <div className="grid max-h-48 gap-1 overflow-y-auto">
                    {(candidatos.data ?? []).slice(0, 6).map((c) => {
                      const n = rotuloDoContato(c, t);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className="n-linha-clicavel items-center gap-3 px-2 py-2"
                          onClick={() => setPaciente({ id: c.id, nome: n })}
                        >
                          <Avatar nome={n} tamanho={28} />
                          <span className="flex-1 truncate text-sm font-semibold">{n}</span>
                          <span className="n-fraco text-xs">{c.phone_number}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={titulo.trim() === "" || !responsavel || salvar.isPending}
          onClick={() => salvar.mutate()}
          data-testid="novo-salvar-tarefa"
        >
          {salvar.isPending ? t("Salvando…") : tarefa ? t("Salvar") : t("Criar tarefa")}
        </button>
        {tarefa && (
          <button
            type="button"
            className="n-botao n-botao-suave w-full text-[var(--n-alerta)]"
            disabled={apagar.isPending}
            onClick={() => {
              if (window.confirm(t("Apagar esta tarefa?"))) apagar.mutate();
            }}
          >
            {t("Apagar tarefa")}
          </button>
        )}
      </div>
    </Folha>
  );
}

/** O painel da tela Hoje: o que venceu e o que vence hoje, e a porta para a lista inteira. */
export function PainelDeTarefas() {
  const t = useT();
  const { role } = useNovo();
  const podeEditar = role !== "viewer";
  const tarefas = useTarefasDaClinica({ aberto: true });
  const [aberta, setAberta] = React.useState<Tarefa | null>(null);
  if (tarefas.error) return null;
  const urgentes = agrupaPorPrazo(tarefas.data ?? [])
    .filter((g) => g.faixa === "atrasada" || g.faixa === "hoje")
    .flatMap((g) => g.tarefas);

  return (
    <section className="n-cartao n-entra p-5" data-testid="novo-painel-tarefas">
      <h2 className="mb-1 flex items-center justify-between text-[15px] font-bold">
        {t("Tarefas de hoje")}
        <span className="n-fraco n-numero">{urgentes.length}</span>
      </h2>
      {urgentes.length === 0 ? (
        <p className="n-suave text-sm">{t("Nada vencendo hoje.")}</p>
      ) : (
        <ul className="divide-y divide-[var(--n-linha)]">
          {urgentes.slice(0, 5).map((x) => (
            <LinhaDaTarefa key={x.id} tarefa={x} podeEditar={podeEditar} aoAbrir={setAberta} />
          ))}
        </ul>
      )}
      <Link
        href="/tarefas"
        className="n-botao n-botao-suave n-botao-pequeno mt-3"
        data-testid="novo-ver-tarefas"
      >
        {t("Ver todas as tarefas")}
      </Link>
      {aberta && <FolhaDaTarefa tarefa={aberta} aoFechar={() => setAberta(null)} />}
    </section>
  );
}
