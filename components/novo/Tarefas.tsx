"use client";

/**
 * TAREFAS na interface nova: a lista (agrupada por prazo), a folha de criar e editar, e o cartão
 * de tarefas na ficha do paciente. Mesmas rotas e mesma regra da versão atual (`/api/v1/tasks`,
 * `lib/tarefas/tipos.ts`): "Somente leitura" vê, quem atende para cima cria e edita.
 *
 * O que muda é a pergunta da clínica: a tarefa pode ficar presa a um paciente ("ligar para a Ana
 * sobre o exame"), e aí aparece na ficha dele também.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { useT } from "@/lib/i18n/IdiomaProvider";
import {
  agrupaPorPrazo,
  estaAtrasada,
  estaEncerrada,
  type FaixaDePrazo,
  type NovaTarefa,
  type PrioridadeDaTarefa,
  type SituacaoDaTarefa,
  type Tarefa,
} from "@/lib/tarefas/tipos";

import { useNovo } from "./Casca";
import { useBuscaDePacientes, usePaciente } from "./dados";
import { Avatar, Folha, Vazio } from "./pecas";

const CHAVE = ["crm_tasks"] as const;

export function useTarefasDaClinica(filtro: { aberto?: boolean; contactId?: string } = {}) {
  const qs = new URLSearchParams();
  if (filtro.aberto) qs.set("aberto", "true");
  if (filtro.contactId) qs.set("contact_id", filtro.contactId);
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
  const { role } = useNovo();
  const podeEditar = role !== "viewer";
  const [filtro, setFiltro] = React.useState<"aberto" | "todas">("aberto");
  const tarefas = useTarefasDaClinica(filtro === "aberto" ? { aberto: true } : {});
  const [aberta, setAberta] = React.useState<Tarefa | "nova" | null>(null);
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

      <div className="mt-6 flex gap-2" role="group" aria-label={t("Quais tarefas")}>
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

      <div className="mt-6 grid gap-6">
        {tarefas.isLoading ? (
          <div className="n-cartao h-40 animate-pulse" />
        ) : tarefas.error ? (
          <Vazio titulo={t("Não foi possível carregar as tarefas.")} />
        ) : grupos.length === 0 ? (
          <Vazio
            titulo={t("Nada pendente")}
            texto={t("Quando algo ficar combinado (ligar de volta, pedir um exame), anote aqui.")}
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
    </div>
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

/** Montada a cada abertura: o estado nasce da tarefa (ou em branco). */
export function FolhaDaTarefa({
  tarefa,
  paciente: pacienteFixo,
  aoFechar,
}: {
  tarefa: Tarefa | null;
  paciente?: { id: string; nome: string };
  aoFechar: () => void;
}) {
  const t = useT();
  const invalidar = useInvalidarTarefas();
  const prazo = separaPrazo(tarefa?.due_date);
  const [titulo, setTitulo] = React.useState(tarefa?.title ?? "");
  const [detalhes, setDetalhes] = React.useState(tarefa?.description ?? "");
  const [dia, setDia] = React.useState(prazo.dia);
  const [hora, setHora] = React.useState(prazo.hora);
  const [prioridade, setPrioridade] = React.useState<PrioridadeDaTarefa>(
    tarefa?.priority ?? "medium",
  );
  const [situacao, setSituacao] = React.useState<SituacaoDaTarefa>(tarefa?.status ?? "pending");
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
          disabled={titulo.trim() === "" || salvar.isPending}
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
