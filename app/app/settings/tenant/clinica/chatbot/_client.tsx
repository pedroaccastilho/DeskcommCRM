"use client";
/**
 * O construtor do chatbot do WhatsApp (módulo clínica): caixas e setas, como o editor de fluxos
 * dos Follow-ups, uma conversa por conexão.
 *
 * Quem monta não é técnico. A clínica começa com o menu de sempre já desenhado
 * (`FLUXO_PADRAO`), acrescenta caixas pela paleta, liga cada saída arrastando a bolinha do
 * cartão até outra caixa e testa a conversa ali mesmo, com o MESMO motor que responde o
 * WhatsApp. Salvar recusa o desenho com problema (`problemasDoFluxo`), o mesmo critério com que
 * o servidor e o executor o recusam: o que a tela diz que está salvo é o que responde.
 */
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Background,
  ConnectionLineType,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { TipoParaMarcar } from "@/lib/clinica/chatbot/agenda-conversa";
import {
  configDoChatbotSchema,
  problemasDoFluxo,
  saidasDoNo,
  type ConfigDoChatbot,
  type Fluxo,
  type NoDoFluxo,
  type TipoDeNo,
} from "@/lib/clinica/chatbot/fluxo";
import { Trash } from "@/lib/ui/icons";

import {
  CartaoDaCaixa,
  TIPOS_DA_PALETA,
  VISUAL,
  caixaNova,
  resumoDaCaixa,
  type NoDoCanvas,
} from "./_caixas";
import { PainelDaCaixa, PainelGeral } from "./_painel";
import { TestarConversa } from "./_testar";

type Conexao = {
  channel_session_id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  configurado: boolean;
  config: ConfigDoChatbot;
};

type Geral = Omit<ConfigDoChatbot, "fluxo">;

const CHAVE = ["clinica", "chatbot"];
const campo = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

// Fora do componente: o React Flow remonta os nós se `nodeTypes` for um objeto novo a cada render.
const nodeTypes: NodeTypes = { caixa: CartaoDaCaixa };

function nomeDaConexao(c: Conexao): string {
  return [c.nome, c.telefone].filter(Boolean).join(" · ") || c.channel_session_id.slice(0, 8);
}

export function ChatbotDoWhatsApp() {
  const t = useT();
  const consulta = useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (
        await apiClient.get<{ data: { conexoes: Conexao[]; tipos: TipoParaMarcar[] } }>(
          "/api/v1/clinica/chatbot",
        )
      ).data,
  });
  const [escolhida, setEscolhida] = useState<string | null>(null);

  if (consulta.isError) {
    return <p className="text-sm text-error-fg">{t("Não foi possível carregar as conexões.")}</p>;
  }
  if (!consulta.data) return null;
  const { conexoes, tipos } = consulta.data;
  if (conexoes.length === 0) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {t("Conecte um WhatsApp em Conexões antes de montar o chatbot.")}
      </p>
    );
  }

  const atual = conexoes.find((c) => c.channel_session_id === escolhida) ?? conexoes[0]!;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {conexoes.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Conexão")}
          <select
            className={`${campo} max-w-sm`}
            value={atual.channel_session_id}
            data-testid="chatbot-conexao"
            onChange={(e) => setEscolhida(e.target.value)}
          >
            {conexoes.map((c) => (
              <option key={c.channel_session_id} value={c.channel_session_id}>
                {nomeDaConexao(c)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {/* A chave remonta o construtor quando a conexão muda: o desenho recomeça do que está salvo. */}
      <ReactFlowProvider key={atual.channel_session_id}>
        <Construtor conexao={atual} tipos={tipos} />
      </ReactFlowProvider>
    </div>
  );
}

function paraCanvas(fluxo: Fluxo): { nos: NoDoCanvas[]; setas: Edge[] } {
  return {
    nos: fluxo.nos.map((no) => ({
      id: no.id,
      type: "caixa" as const,
      position: no.posicao,
      deletable: false,
      data: { no, resumo: "" },
    })),
    setas: fluxo.setas.map((s) => ({
      id: s.id,
      source: s.origem,
      sourceHandle: s.saida,
      target: s.destino,
      deletable: false,
    })),
  };
}

function doCanvas(nos: NoDoCanvas[], setas: Edge[]): Fluxo {
  return {
    nos: nos.map((n) => ({
      ...n.data.no,
      posicao: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    setas: setas.map((e) => ({
      id: e.id,
      origem: e.source,
      saida: e.sourceHandle ?? "seguir",
      destino: e.target,
    })),
  };
}

/** Um id que ainda não existe na lista, com o prefixo dado. */
function idLivre(prefixo: string, usados: Iterable<string>): string {
  const ocupados = new Set(usados);
  for (let n = 1; ; n++) {
    const id = `${prefixo}-${n}`;
    if (!ocupados.has(id)) return id;
  }
}

function Construtor({ conexao, tipos }: { conexao: Conexao; tipos: TipoParaMarcar[] }) {
  const t = useT();
  const inicial = useMemo(() => paraCanvas(conexao.config.fluxo), [conexao.config.fluxo]);
  const [nos, setNos, onNodesChange] = useNodesState<NoDoCanvas>(inicial.nos);
  const [setas, setSetas, onEdgesChange] = useEdgesState<Edge>(inicial.setas);
  const [geral, setGeral] = useState<Geral>(() => {
    const { fluxo: _fluxo, ...resto } = conexao.config;
    return resto;
  });
  const [salvoComo, setSalvoComo] = useState(() => JSON.stringify(conexao.config));
  const [selecionado, setSelecionado] = useState<{ tipo: "caixa" | "seta"; id: string } | null>(
    null,
  );
  const [testando, setTestando] = useState(false);
  const nomeDoTipo = useCallback(
    (id: string) => tipos.find((x) => x.id === id)?.nome ?? null,
    [tipos],
  );

  const fluxo = useMemo(() => doCanvas(nos, setas), [nos, setas]);
  const config = useMemo<ConfigDoChatbot>(() => ({ ...geral, fluxo }), [geral, fluxo]);
  const alterado = JSON.stringify(config) !== salvoComo;

  // Os problemas que impedem salvar: os do schema (texto vazio, opção sem nome) e os do desenho.
  const problemas = useMemo(() => {
    const lista: { noId: string | null; mensagem: string }[] = [];
    const lido = configDoChatbotSchema.safeParse(config);
    if (!lido.success) {
      for (const issue of lido.error.issues) {
        const daCaixa = issue.path[0] === "fluxo" && issue.path[1] === "nos";
        lista.push({
          noId: daCaixa ? (fluxo.nos[Number(issue.path[2])]?.id ?? null) : null,
          mensagem: issue.message,
        });
      }
    } else {
      lista.push(...problemasDoFluxo(lido.data.fluxo));
    }
    return lista;
  }, [config, fluxo.nos]);

  const nosParaDesenhar = useMemo(
    () =>
      nos.map((n) => {
        const meus = problemas.filter((p) => p.noId === n.id).map((p) => p.mensagem);
        return {
          ...n,
          selected: selecionado?.tipo === "caixa" && selecionado.id === n.id,
          data: {
            ...n.data,
            resumo: resumoDaCaixa(n.data.no, nomeDoTipo),
            ...(meus.length ? { problemas: meus } : {}),
          },
        };
      }),
    [nos, problemas, selecionado, nomeDoTipo],
  );
  const setasParaDesenhar = useMemo(
    () =>
      setas.map((e) => ({
        ...e,
        type: "smoothstep" as const,
        selected: selecionado?.tipo === "seta" && selecionado.id === e.id,
      })),
    [setas, selecionado],
  );

  const salvar = useMutation({
    mutationFn: () =>
      apiClient.put("/api/v1/clinica/chatbot", {
        channel_session_id: conexao.channel_session_id,
        config,
      }),
    onSuccess: () => setSalvoComo(JSON.stringify(config)),
    onError: showApiError,
  });

  /** Uma saída tem uma seta só: ligar de novo a mesma bolinha troca o destino. */
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      setSetas((atuais) => [
        ...atuais.filter(
          (e) =>
            !(
              e.source === c.source && (e.sourceHandle ?? "seguir") === (c.sourceHandle ?? "seguir")
            ),
        ),
        {
          id: idLivre(
            "s",
            atuais.map((e) => e.id),
          ),
          source: c.source,
          sourceHandle: c.sourceHandle ?? "seguir",
          target: c.target,
          deletable: false,
        },
      ]);
    },
    [setSetas],
  );

  const mudarCaixa = useCallback(
    (no: NoDoFluxo) => {
      setNos((atuais) =>
        atuais.map((n) => (n.id === no.id ? { ...n, data: { ...n.data, no } } : n)),
      );
      // Opção do menu removida leva a seta junto: seta saindo de opção que não existe não salva.
      const saidas = new Set(saidasDoNo(no).map((s) => s.id));
      setSetas((atuais) =>
        atuais.filter((e) => e.source !== no.id || saidas.has(e.sourceHandle ?? "seguir")),
      );
    },
    [setNos, setSetas],
  );

  const excluirCaixa = useCallback(
    (id: string) => {
      setNos((atuais) => atuais.filter((n) => n.id !== id));
      setSetas((atuais) => atuais.filter((e) => e.source !== id && e.target !== id));
      setSelecionado(null);
    },
    [setNos, setSetas],
  );

  const adicionar = useCallback(
    (tipo: TipoDeNo) => {
      const id = idLivre(
        tipo,
        nos.map((n) => n.id),
      );
      const maisBaixo = nos.reduce((max, n) => Math.max(max, n.position.y), 0);
      const no = caixaNova(tipo, id, { x: 40 + (nos.length % 4) * 260, y: maisBaixo + 180 });
      setNos((atuais) => [
        ...atuais,
        {
          id,
          type: "caixa" as const,
          position: no.posicao,
          deletable: false,
          data: { no, resumo: "" },
        },
      ]);
      setSelecionado({ tipo: "caixa", id });
      setTestando(false);
    },
    [nos, setNos],
  );

  const caixa =
    selecionado?.tipo === "caixa"
      ? (nos.find((n) => n.id === selecionado.id)?.data.no ?? null)
      : null;
  const seta =
    selecionado?.tipo === "seta" ? (setas.find((e) => e.id === selecionado.id) ?? null) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={geral.ativo}
            onCheckedChange={(ativo) => setGeral((g) => ({ ...g, ativo }))}
            data-testid="chatbot-ativo"
          />
          {t("Responder esta conexão com o chatbot")}
        </label>
        {geral.ativo ? (
          <Badge variant="default">{t("A IA não responde nesta conexão")}</Badge>
        ) : (
          <Badge variant="secondary">{t("Desligado: a conexão segue como está")}</Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {alterado && (
            <span className="text-xs text-warning-fg">{t("Alterações não salvas")}</span>
          )}
          {!alterado && salvar.isSuccess && (
            <span className="text-xs text-success-fg">{t("Salvo")}</span>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="chatbot-testar"
            onClick={() => {
              setTestando((v) => !v);
              setSelecionado(null);
            }}
          >
            {testando ? t("Fechar teste") : t("Testar conversa")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!alterado || problemas.length > 0 || salvar.isPending}
            data-testid="chatbot-salvar"
            onClick={() => salvar.mutate()}
          >
            {salvar.isPending ? t("Salvando…") : t("Salvar")}
          </Button>
        </div>
      </div>

      {problemas.length > 0 && (
        <p
          className="rounded-md border border-error/40 bg-error-bg p-2 text-sm text-error-fg"
          role="alert"
          data-testid="chatbot-problemas"
        >
          {t("Corrija antes de salvar:")} {t(problemas[0]!.mensagem)}
          {problemas.length > 1 ? ` (+${problemas.length - 1})` : ""}
        </p>
      )}

      <div className="flex flex-wrap gap-2" data-testid="chatbot-paleta">
        <span className="self-center text-xs text-text-muted">{t("Adicionar caixa:")}</span>
        {TIPOS_DA_PALETA.map((tipo) => {
          const Icone = VISUAL[tipo].icone;
          return (
            <Button
              key={tipo}
              type="button"
              variant="outline"
              size="sm"
              title={t(VISUAL[tipo].ajuda)}
              data-testid={`chatbot-paleta-${tipo}`}
              onClick={() => adicionar(tipo)}
            >
              <Icone size={14} aria-hidden /> {t(VISUAL[tipo].nome)}
            </Button>
          );
        })}
      </div>

      <div className="flex min-h-[560px] flex-1 flex-col overflow-hidden rounded-md border border-border lg:flex-row">
        <div
          className="relative h-[60vh] min-h-[420px] flex-1 lg:h-auto"
          data-testid="chatbot-canvas"
        >
          <ReactFlow
            nodes={nosParaDesenhar}
            edges={setasParaDesenhar}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelecionado({ tipo: "caixa", id: n.id });
              setTestando(false);
            }}
            onEdgeClick={(_, e) => {
              setSelecionado({ tipo: "seta", id: e.id });
              setTestando(false);
            }}
            onPaneClick={() => setSelecionado(null)}
            // Apagar é pelo botão do painel, nunca por tecla: um Backspace no texto não some com caixa.
            deleteKeyCode={null}
            defaultEdgeOptions={{ type: "smoothstep" }}
            connectionLineType={ConnectionLineType.SmoothStep}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <aside className="max-h-[70vh] overflow-y-auto border-t border-border bg-surface p-4 lg:max-h-none lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l">
          {testando ? (
            <TestarConversa config={config} tipos={tipos} />
          ) : caixa ? (
            <PainelDaCaixa
              key={caixa.id}
              no={caixa}
              tipos={tipos}
              onChange={mudarCaixa}
              onExcluir={() => excluirCaixa(caixa.id)}
            />
          ) : seta ? (
            <div className="flex flex-col gap-3" data-testid="chatbot-painel-seta">
              <h2 className="text-sm font-semibold">{t("Seta")}</h2>
              <p className="text-xs text-text-muted">
                {t("Para mudar o destino, arraste de novo a bolinha da saída até outra caixa.")}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start text-error-fg"
                onClick={() => {
                  setSetas((atuais) => atuais.filter((e) => e.id !== seta.id));
                  setSelecionado(null);
                }}
              >
                <Trash size={14} aria-hidden /> {t("Remover seta")}
              </Button>
            </div>
          ) : (
            <PainelGeral
              config={config}
              onChange={(parcial) => setGeral((g) => ({ ...g, ...parcial }))}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
