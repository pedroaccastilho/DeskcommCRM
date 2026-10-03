"use client";
/**
 * O painel ao lado do canvas: com uma caixa selecionada, o formulário dela; sem nada
 * selecionado, os textos gerais do chatbot (o "não entendi", o aviso da recepção e depois de
 * quanto tempo parado ele recomeça).
 */
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type { TipoParaMarcar } from "@/lib/clinica/chatbot/agenda-conversa";
import {
  MAXIMO_DE_OPCOES,
  type ConfigDoChatbot,
  type NoDoFluxo,
} from "@/lib/clinica/chatbot/fluxo";
import { CaretDown, CaretUp, Plus, Trash } from "@/lib/ui/icons";

import { VISUAL } from "./_caixas";

const campo = "w-full rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

function Campo({
  rotulo,
  ajuda,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-text-muted">
      {rotulo}
      {children}
      {ajuda ? <span className="font-normal">{ajuda}</span> : null}
    </label>
  );
}

export function PainelDaCaixa({
  no,
  tipos,
  onChange,
  onExcluir,
}: {
  no: NoDoFluxo;
  tipos: TipoParaMarcar[];
  onChange: (no: NoDoFluxo) => void;
  onExcluir: () => void;
}) {
  const t = useT();
  const visual = VISUAL[no.tipo];

  return (
    <div className="flex flex-col gap-4" data-testid="chatbot-painel-caixa">
      <div>
        <h2 className="text-sm font-semibold">{t(visual.nome)}</h2>
        <p className="text-xs text-text-muted">{t(visual.ajuda)}</p>
      </div>

      {(no.tipo === "mensagem" ||
        no.tipo === "pergunta" ||
        no.tipo === "recepcao" ||
        no.tipo === "menu") && (
        <Campo rotulo={no.tipo === "menu" ? t("Pergunta do menu") : t("Texto")}>
          <textarea
            className={`${campo} min-h-24`}
            value={no.texto}
            maxLength={2000}
            data-testid="chatbot-campo-texto"
            onChange={(e) => onChange({ ...no, texto: e.target.value })}
          />
        </Campo>
      )}

      {no.tipo === "fim" && (
        <Campo
          rotulo={t("Mensagem de despedida")}
          ajuda={t("Opcional. Em branco, a conversa só termina.")}
        >
          <textarea
            className={`${campo} min-h-20`}
            value={no.texto}
            maxLength={1000}
            onChange={(e) => onChange({ ...no, texto: e.target.value })}
          />
        </Campo>
      )}

      {no.tipo === "menu" && <OpcoesDoMenu no={no} onChange={onChange} />}

      {no.tipo === "pergunta" && (
        <Campo rotulo={t("O que fazer com a resposta")}>
          <select
            className={campo}
            value={no.guardar_em}
            onChange={(e) => onChange({ ...no, guardar_em: e.target.value as "nada" | "nome" })}
          >
            <option value="nada">{t("Só seguir a conversa")}</option>
            <option value="nome">{t("Guardar como nome do contato")}</option>
          </select>
        </Campo>
      )}

      {no.tipo === "marcar" && (
        <Campo
          rotulo={t("Atendimento")}
          ajuda={t("Os horários vêm da agenda de quem atende esse tipo de atendimento.")}
        >
          <select
            className={campo}
            value={no.tipo_id ?? ""}
            data-testid="chatbot-campo-atendimento"
            onChange={(e) => onChange({ ...no, tipo_id: e.target.value || null })}
          >
            <option value="">{t("O paciente escolhe")}</option>
            {tipos.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {tipo.nome}
              </option>
            ))}
          </select>
        </Campo>
      )}

      {(no.tipo === "marcar" || no.tipo === "remarcar_cancelar") && (
        <p className="rounded-md bg-surface-elevated p-2 text-xs text-text-muted">
          {t(
            "Se a saída de quando não deu certo ficar sem seta, o chatbot passa a conversa para a recepção.",
          )}
        </p>
      )}

      {no.tipo !== "inicio" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-error-fg"
          onClick={onExcluir}
        >
          <Trash size={14} aria-hidden /> {t("Excluir caixa")}
        </Button>
      )}
    </div>
  );
}

function OpcoesDoMenu({
  no,
  onChange,
}: {
  no: Extract<NoDoFluxo, { tipo: "menu" }>;
  onChange: (no: NoDoFluxo) => void;
}) {
  const t = useT();
  const mudar = (opcoes: typeof no.opcoes) => onChange({ ...no, opcoes });
  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= no.opcoes.length) return;
    const nova = [...no.opcoes];
    [nova[i], nova[j]] = [nova[j]!, nova[i]!];
    mudar(nova);
  };
  const proximoId = () => {
    const usados = new Set(no.opcoes.map((o) => o.id));
    for (let n = no.opcoes.length + 1; ; n++) {
      const id = `${no.id}-o${n}`;
      if (!usados.has(id)) return id;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-text-muted">{t("Opções")}</p>
      {no.opcoes.map((opcao, i) => (
        <div
          key={opcao.id}
          className="flex items-center gap-1"
          data-testid={`chatbot-opcao-${i + 1}`}
        >
          <span className="w-5 text-right text-xs text-text-muted">{i + 1}</span>
          <input
            className={`${campo} flex-1`}
            value={opcao.rotulo}
            maxLength={60}
            aria-label={t("Nome da opção")}
            onChange={(e) =>
              mudar(no.opcoes.map((o, j) => (j === i ? { ...o, rotulo: e.target.value } : o)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Subir")}
            onClick={() => mover(i, -1)}
          >
            <CaretUp size={14} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Descer")}
            onClick={() => mover(i, 1)}
          >
            <CaretDown size={14} aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("Remover opção")}
            disabled={no.opcoes.length <= 1}
            onClick={() => mudar(no.opcoes.filter((_, j) => j !== i))}
          >
            <Trash size={14} aria-hidden />
          </Button>
        </div>
      ))}
      {no.opcoes.length < MAXIMO_DE_OPCOES && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          data-testid="chatbot-adicionar-opcao"
          onClick={() => mudar([...no.opcoes, { id: proximoId(), rotulo: t("Nova opção") }])}
        >
          <Plus size={14} aria-hidden /> {t("Adicionar opção")}
        </Button>
      )}
      <p className="text-xs text-text-muted">
        {t("Ligue cada opção a uma caixa arrastando a bolinha ao lado dela no cartão.")}
      </p>
    </div>
  );
}

export function PainelGeral({
  config,
  onChange,
}: {
  config: ConfigDoChatbot;
  onChange: (parcial: Partial<ConfigDoChatbot>) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4" data-testid="chatbot-painel-geral">
      <div>
        <h2 className="text-sm font-semibold">{t("Textos gerais")}</h2>
        <p className="text-xs text-text-muted">
          {t(
            "Clique numa caixa para editar o que ela diz. Aqui ficam os textos que valem para a conversa inteira.",
          )}
        </p>
      </div>
      <Campo
        rotulo={t("Quando o chatbot não entende")}
        ajuda={t(
          "A pergunta é repetida logo abaixo. Depois de 3 vezes sem entender, ele chama a recepção.",
        )}
      >
        <textarea
          className={`${campo} min-h-16`}
          value={config.nao_entendi}
          maxLength={500}
          onChange={(e) => onChange({ nao_entendi: e.target.value })}
        />
      </Campo>
      <Campo
        rotulo={t("Aviso de quando chama a recepção")}
        ajuda={t("Usado quando o paciente pede um atendente ou quando a agenda não deu certo.")}
      >
        <textarea
          className={`${campo} min-h-16`}
          value={config.recepcao}
          maxLength={500}
          onChange={(e) => onChange({ recepcao: e.target.value })}
        />
      </Campo>
      <Campo rotulo={t("Recomeçar do Início depois de quantas horas sem conversa")}>
        <input
          type="number"
          min={1}
          max={72}
          className={`${campo} w-24`}
          value={config.reiniciar_apos_horas}
          onChange={(e) =>
            onChange({
              reiniciar_apos_horas: Math.min(72, Math.max(1, Number(e.target.value) || 1)),
            })
          }
        />
      </Campo>
      <p className="rounded-md bg-surface-elevated p-2 text-xs text-text-muted">
        {t(
          "Em qualquer ponto o paciente pode digitar 0 para voltar ao Início ou pedir um atendente. Sinais de urgência (dor forte, queda, falta de ar) passam a conversa para a equipe na hora.",
        )}
      </p>
    </div>
  );
}
