"use client";
/**
 * O chatbot de menu de cada conexão de WhatsApp, montado num formulário (módulo clínica).
 *
 * Quem monta não é técnico: nada de fluxograma. Uma saudação, as opções em ordem (cada uma com
 * o nome que o paciente lê e o que ela faz), os dois textos de apoio, e ao lado a prévia de como
 * a mensagem chega no WhatsApp. A prévia usa o MESMO `textoDoMenu` do motor, então o que a tela
 * mostra é o que o paciente recebe.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import {
  ACOES_DO_MENU,
  MAXIMO_DE_OPCOES,
  ROTULO_DA_ACAO,
  configDoChatbotSchema,
  type AcaoDoMenu,
  type ConfigDoChatbot,
  type OpcaoDoMenu,
} from "@/lib/clinica/chatbot/config";
import { textoDoMenu } from "@/lib/clinica/chatbot/motor";

type Conexao = {
  channel_session_id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  configurado: boolean;
  config: ConfigDoChatbot;
};

const CHAVE = ["clinica", "chatbot"];
const campo = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

/** O que cada ação faz, dito para quem monta o menu. */
const AJUDA_DA_ACAO: Record<AcaoDoMenu, string> = {
  agendar: "Mostra os tipos de atendimento e os próximos horários livres, e marca o escolhido.",
  proximo_horario: "Lista os horários que o paciente já tem marcados.",
  remarcar_cancelar:
    "Mostra os horários do paciente e deixa remarcar ou cancelar. Avisa a multa antes de cancelar em cima da hora.",
  recepcao: "Manda o texto da recepção e passa a conversa para a equipe.",
  texto: "Responde com um texto que você escreve (endereço, preços, preparo).",
};

function nomeDaConexao(c: Conexao): string {
  return [c.nome, c.telefone].filter(Boolean).join(" · ") || c.channel_session_id.slice(0, 8);
}

export function ChatbotDoWhatsApp() {
  const t = useT();
  const conexoes = useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await apiClient.get<{ data: { conexoes: Conexao[] } }>("/api/v1/clinica/chatbot")).data.conexoes,
  });
  const [escolhida, setEscolhida] = useState<string | null>(null);

  if (conexoes.isError) {
    return <p className="text-danger text-sm">{t("Não foi possível carregar as conexões.")}</p>;
  }
  if (!conexoes.data) return null;
  if (conexoes.data.length === 0) {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {t("Conecte um WhatsApp em Conexões antes de montar o chatbot.")}
      </p>
    );
  }

  const atual =
    conexoes.data.find((c) => c.channel_session_id === escolhida) ?? conexoes.data[0]!;

  return (
    <div className="flex flex-col gap-4">
      {conexoes.data.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Conexão")}
          <select
            className={`${campo} max-w-sm`}
            value={atual.channel_session_id}
            data-testid="chatbot-conexao"
            onChange={(e) => setEscolhida(e.target.value)}
          >
            {conexoes.data.map((c) => (
              <option key={c.channel_session_id} value={c.channel_session_id}>
                {nomeDaConexao(c)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {/* A chave remonta o formulário quando a conexão muda ou o servidor devolve outra
          configuração: o rascunho recomeça do que está salvo, sem efeito sincronizando estado. */}
      <FormularioDoChatbot
        key={`${atual.channel_session_id}:${JSON.stringify(atual.config)}`}
        conexao={atual}
      />
    </div>
  );
}

function FormularioDoChatbot({ conexao }: { conexao: Conexao }) {
  const t = useT();
  const qc = useQueryClient();
  const [config, setConfig] = useState<ConfigDoChatbot>(conexao.config);
  const [salvo, setSalvo] = useState(false);

  const mudar = (parcial: Partial<ConfigDoChatbot>) => {
    setSalvo(false);
    setConfig((c) => ({ ...c, ...parcial }));
  };
  const mudarOpcao = (i: number, parcial: Partial<OpcaoDoMenu>) =>
    mudar({ opcoes: config.opcoes.map((o, j) => (j === i ? { ...o, ...parcial } : o)) });
  const moverOpcao = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= config.opcoes.length) return;
    const opcoes = [...config.opcoes];
    [opcoes[i], opcoes[j]] = [opcoes[j]!, opcoes[i]!];
    mudar({ opcoes });
  };

  const validacao = configDoChatbotSchema.safeParse(config);
  const salvar = useMutation({
    mutationFn: () =>
      apiClient.put("/api/v1/clinica/chatbot", {
        channel_session_id: conexao.channel_session_id,
        config,
      }),
    onSuccess: () => {
      setSalvo(true);
      void qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: showApiError,
  });

  return (
    <form
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (validacao.success && !salvar.isPending) salvar.mutate();
      }}
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={config.ativo}
              data-testid="chatbot-ativo"
              onChange={(e) => mudar({ ativo: e.target.checked })}
            />
            {t("Chatbot ligado nesta conexão")}
            <Badge variant={config.ativo ? "success" : "secondary"}>
              {config.ativo ? t("Ligado") : t("Desligado")}
            </Badge>
          </label>
          <p className="text-xs text-text-muted">
            {t(
              "Ligado, ele responde toda mensagem que chega nesta conexão e a IA fica calada nela. Quando uma pessoa da equipe assume a conversa, o chatbot para de responder.",
            )}
          </p>
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Saudação")}
            <textarea
              className={`${campo} min-h-20`}
              value={config.saudacao}
              maxLength={1000}
              data-testid="chatbot-saudacao"
              onChange={(e) => mudar({ saudacao: e.target.value })}
            />
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-md border border-border p-3">
          <h2 className="text-sm font-semibold">{t("Opções do menu")}</h2>
          <ol className="flex flex-col gap-3">
            {config.opcoes.map((opcao, i) => (
              <li
                key={i}
                className="flex flex-col gap-2 rounded-md border border-border/60 p-2"
                data-testid={`chatbot-opcao-${i + 1}`}
              >
                <div className="flex flex-wrap items-end gap-2">
                  <span className="pb-2 text-sm font-semibold">{i + 1}</span>
                  <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-text-muted">
                    {t("Nome que o paciente lê")}
                    <input
                      className={campo}
                      value={opcao.rotulo}
                      maxLength={60}
                      onChange={(e) => mudarOpcao(i, { rotulo: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    {t("O que faz")}
                    <select
                      className={campo}
                      value={opcao.acao}
                      onChange={(e) => mudarOpcao(i, { acao: e.target.value as AcaoDoMenu })}
                    >
                      {ACOES_DO_MENU.map((a) => (
                        <option key={a} value={a}>
                          {t(ROTULO_DA_ACAO[a])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("Subir")}
                      disabled={i === 0}
                      onClick={() => moverOpcao(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t("Descer")}
                      disabled={i === config.opcoes.length - 1}
                      onClick={() => moverOpcao(i, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={config.opcoes.length === 1}
                      onClick={() => mudar({ opcoes: config.opcoes.filter((_, j) => j !== i) })}
                    >
                      {t("Remover")}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-text-muted">{t(AJUDA_DA_ACAO[opcao.acao])}</p>
                {opcao.acao === "texto" ? (
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    {t("Texto da resposta")}
                    <textarea
                      className={`${campo} min-h-16`}
                      value={opcao.texto ?? ""}
                      maxLength={1000}
                      onChange={(e) => mudarOpcao(i, { texto: e.target.value })}
                    />
                  </label>
                ) : null}
              </li>
            ))}
          </ol>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={config.opcoes.length >= MAXIMO_DE_OPCOES}
              data-testid="chatbot-adicionar-opcao"
              onClick={() =>
                mudar({ opcoes: [...config.opcoes, { rotulo: "", acao: "texto", texto: "" }] })
              }
            >
              {t("Adicionar opção")}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-md border border-border p-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Quando o paciente responde algo que o chatbot não entende")}
            <textarea
              className={`${campo} min-h-16`}
              value={config.nao_entendi}
              maxLength={500}
              onChange={(e) => mudar({ nao_entendi: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Ao chamar a recepção")}
            <textarea
              className={`${campo} min-h-16`}
              value={config.recepcao}
              maxLength={500}
              onChange={(e) => mudar({ recepcao: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            {t("Recomeçar do menu depois de quantas horas sem conversa")}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={72}
              step={1}
              className={`${campo} w-24`}
              value={config.reiniciar_apos_horas}
              onChange={(e) => mudar({ reiniciar_apos_horas: Number(e.target.value) })}
            />
          </label>
          <p className="text-xs text-text-muted">
            {t(
              "Em qualquer passo o paciente pode digitar 0 para voltar ao menu. Pedido de atendente vai para a recepção, e sinal de urgência (dor forte, queda, falta de ar) manda procurar o pronto atendimento e chama a equipe.",
            )}
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!validacao.success || salvar.isPending} data-testid="chatbot-salvar">
            {t("Salvar chatbot")}
          </Button>
          {!validacao.success ? (
            <span className="text-danger text-sm" role="alert">
              {t(validacao.error.issues[0]?.message ?? "Configuração inválida.")}
            </span>
          ) : salvo ? (
            <span className="text-sm text-text-muted" role="status">
              {t("Chatbot salvo.")}
            </span>
          ) : null}
        </div>
      </div>

      <aside className="flex flex-col gap-2" aria-label={t("Prévia no WhatsApp")}>
        <h2 className="text-sm font-semibold">{t("Prévia no WhatsApp")}</h2>
        <div className="rounded-md bg-surface p-3">
          <p
            className="whitespace-pre-wrap rounded-md bg-surface-elevated p-3 text-sm text-text shadow-sm"
            data-testid="chatbot-previa"
          >
            {textoDoMenu(config)}
          </p>
        </div>
      </aside>
    </form>
  );
}
