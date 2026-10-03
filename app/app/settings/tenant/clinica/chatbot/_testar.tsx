"use client";
/**
 * "Testar conversa": o fluxo desenhado AGORA (mesmo antes de salvar) conversando com quem monta,
 * pelo MESMO motor que responde o WhatsApp (`lib/clinica/chatbot/motor.ts`). A agenda é de
 * mentira — horários de exemplo, nada é marcado de verdade — e a passagem para a recepção só
 * aparece como aviso.
 */
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import type {
  CompromissoDoPaciente,
  HorarioOferecido,
  TipoParaMarcar,
} from "@/lib/clinica/chatbot/agenda-conversa";
import type { ConfigDoChatbot } from "@/lib/clinica/chatbot/fluxo";
import { responder, type DepsDoChatbot, type EstadoDoChatbot } from "@/lib/clinica/chatbot/motor";

type Fala = { de: "paciente" | "chatbot" | "aviso"; texto: string };

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function rotulo(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  return `${DIAS[d.getDay()]} ${dd}/${mm} às ${hh}:00`;
}

/** Uma agenda de exemplo para o teste: dois atendimentos, horários nos próximos dias, um marcado. */
function agendaDeTeste(tipos: TipoParaMarcar[]): DepsDoChatbot {
  const amanha = (dias: number, hora: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(hora, 0, 0, 0);
    return d;
  };
  const exemplo = tipos.length > 0 ? tipos : [{ id: "exemplo", nome: "Fisioterapia" }];
  const horarios: HorarioOferecido[] = [
    [1, 9],
    [1, 14],
    [2, 10],
    [3, 16],
  ].map(([dias, hora]) => {
    const d = amanha(dias!, hora!);
    return { inicio: d.toISOString(), rotulo: rotulo(d) };
  });
  const marcado: CompromissoDoPaciente = {
    id: "teste",
    rotulo: `${rotulo(amanha(4, 9))} · ${exemplo[0]!.nome}`,
    tipoId: exemplo[0]!.id,
    tipoNome: exemplo[0]!.nome,
  };
  return {
    agora: () => new Date(),
    guardarNome: async () => undefined,
    tiposParaMarcar: async () => ({ ok: true, tipos: exemplo }),
    horariosLivres: async () => ({ ok: true, horarios }),
    proximosCompromissos: async () => ({ ok: true, compromissos: [marcado] }),
    marcar: async () => ({ ok: true, aguardaConfirmacao: false }),
    remarcar: async () => ({ ok: true }),
    cancelar: async () => ({ ok: true }),
    multaSeCancelarAgora: async () => null,
    formatarDinheiro: (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`,
  };
}

export function TestarConversa({
  config,
  tipos,
}: {
  config: ConfigDoChatbot;
  tipos: TipoParaMarcar[];
}) {
  const t = useT();
  const deps = useMemo(() => agendaDeTeste(tipos), [tipos]);
  const [falas, setFalas] = useState<Fala[]>([]);
  const [estado, setEstado] = useState<EstadoDoChatbot | null>(null);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function enviar() {
    const msg = texto.trim();
    if (!msg || ocupado) return;
    setTexto("");
    setOcupado(true);
    try {
      const r = await responder(config, estado, msg, deps);
      setEstado(r.estado);
      setFalas((f) => [
        ...f,
        { de: "paciente", texto: msg },
        ...r.mensagens.map((m) => ({ de: "chatbot" as const, texto: m })),
        ...(r.passarParaRecepcao
          ? [
              {
                de: "aviso" as const,
                texto: t("Aqui a conversa passaria para a recepção e o chatbot pararia."),
              },
            ]
          : []),
        ...(!r.passarParaRecepcao && r.estado === null
          ? [
              {
                de: "aviso" as const,
                texto: t("Fim da conversa. A próxima mensagem começa do Início."),
              },
            ]
          : []),
      ]);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2" data-testid="chatbot-teste">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t("Testar conversa")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setFalas([]);
            setEstado(null);
          }}
        >
          {t("Recomeçar")}
        </Button>
      </div>
      <p className="text-xs text-text-muted">
        {t(
          "Usa o fluxo como está na tela, mesmo sem salvar. A agenda é de exemplo: nada é marcado de verdade.",
        )}
      </p>
      <div className="flex min-h-48 flex-1 flex-col gap-2 overflow-y-auto rounded-md bg-surface-elevated p-2">
        {falas.length === 0 && (
          <p className="text-xs text-text-muted">
            {t("Escreva uma mensagem como se fosse o paciente.")}
          </p>
        )}
        {falas.map((f, i) => (
          <div
            key={i}
            className={
              f.de === "paciente"
                ? "ml-8 self-end rounded-md bg-accent-soft px-2 py-1 text-sm whitespace-pre-wrap text-text"
                : f.de === "chatbot"
                  ? "mr-8 self-start rounded-md border border-border bg-surface px-2 py-1 text-sm whitespace-pre-wrap text-text"
                  : "self-center text-center text-xs text-text-muted italic"
            }
            data-testid={`chatbot-teste-fala-${f.de}`}
          >
            {f.texto}
          </div>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <input
          className="min-w-0 flex-1 rounded-md border border-border bg-surface-elevated p-2 text-sm text-text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={t("Mensagem do paciente")}
          aria-label={t("Mensagem do paciente")}
          data-testid="chatbot-teste-entrada"
        />
        <Button type="submit" size="sm" disabled={ocupado || !texto.trim()}>
          {t("Enviar")}
        </Button>
      </form>
    </div>
  );
}
