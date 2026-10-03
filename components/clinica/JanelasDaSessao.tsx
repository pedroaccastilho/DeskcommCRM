"use client";

/**
 * AS JANELAS RÁPIDAS DE UMA SESSÃO — remarcar, marcar a próxima, cancelar e mandar WhatsApp sem
 * sair da tela.
 *
 * Módulo clínica (fork TOQ). Nasceram no Balcão da recepção e servem a qualquer tela que mostre
 * uma sessão da grade da clínica (`SessaoDaGrade`). Quem usa não é técnico: cada janela faz uma
 * coisa, já traz a regra da clínica aplicada (multa, prazo) e volta para o mesmo lugar.
 *
 * Nenhuma regra mora aqui. Horários livres vêm de `/api/v1/agenda/horarios-livres`, a prévia da
 * multa é a mesma conta da rota (`previaDaMulta`), e quem decide de verdade é o servidor.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useHorariosLivres } from "@/hooks/agenda/useHorariosLivres";
import { useMarcarAgendamento } from "@/hooks/agenda/useMarcarAgendamento";
import { useRemarcarAgendamento } from "@/hooks/agenda/useRemarcarAgendamento";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { instanteDe, partesNoFuso } from "@/lib/agenda/fuso";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";
import type { PoliticaDaAgenda, SessaoDaGrade } from "@/lib/clinica/agenda";
import { previaDaMulta } from "@/lib/clinica/balcao";
import { formatCents, moedaServidaOu } from "@/lib/money";
import { cn } from "@/lib/utils";

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

function horaNoFuso(iso: string, fuso: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: fuso,
  }).format(new Date(iso));
}

/** Depois de qualquer ação, a grade da clínica, a da agenda e as multas repintam. */
export function useRecarregarBalcao() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["clinica", "balcao"] });
    void qc.invalidateQueries({ queryKey: ["clinica", "multas"] });
    void qc.invalidateQueries({ queryKey: ["agenda"] });
  }, [qc]);
}

// ─── Escolher dia e horário ──────────────────────────────────────────────────

type Dia = { ano: number; mes: number; dia: number };

/** `quantos` dias seguidos, a partir de hoje mais `aPartirDe`. */
function proximosDias(fuso: string, quantos: number, aPartirDe = 0): Dia[] {
  const hoje = partesNoFuso(new Date(), fuso);
  const dias: Dia[] = [];
  for (let i = 0; i < quantos; i += 1) {
    const d = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia + aPartirDe + i, 12));
    dias.push({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() });
  }
  return dias;
}

/**
 * A fileira de dias e os horários livres do profissional naquele dia, para o tipo da sessão. É a
 * mesma escolha em remarcar e em marcar a próxima; só muda de onde a fileira começa.
 */
function EscolhaDeHorario({
  sessao,
  fuso,
  aberta,
  aPartirDe,
  diaInicial,
  slot,
  aoEscolher,
}: {
  sessao: SessaoDaGrade;
  fuso: string;
  aberta: boolean;
  /** Primeiro dia da fileira, em dias depois de hoje. */
  aPartirDe: number;
  /** Dia já escolhido quando a janela abre, contado na fileira. */
  diaInicial: number;
  slot: string | null;
  aoEscolher: (slot: string | null) => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const dias = React.useMemo(() => proximosDias(fuso, 21, aPartirDe), [fuso, aPartirDe]);
  const [diaEscolhido, setDiaEscolhido] = React.useState(diaInicial);
  const fileira = React.useRef<HTMLDivElement>(null);

  // O dia sugerido pode estar fora da vista no celular: a fileira rola até ele ao abrir.
  React.useEffect(() => {
    fileira.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);

  const dia = dias[diaEscolhido]!;
  const filtro = React.useMemo(() => {
    if (!aberta || !sessao.tipo) return null;
    const de = instanteDe({ ...dia }, fuso);
    const amanha = new Date(Date.UTC(dia.ano, dia.mes - 1, dia.dia + 1, 12));
    const ate = instanteDe(
      { ano: amanha.getUTCFullYear(), mes: amanha.getUTCMonth() + 1, dia: amanha.getUTCDate() },
      fuso,
    );
    return {
      event_type_id: sessao.tipo.id,
      ...(sessao.profissional_user_id ? { owner_user_id: sessao.profissional_user_id } : {}),
      de: de.toISOString(),
      ate: ate.toISOString(),
    };
  }, [aberta, sessao.tipo, sessao.profissional_user_id, dia, fuso]);
  const livres = useHorariosLivres(filtro);
  // O relógio é lido uma vez, quando a janela abre: ela é montada a cada abertura.
  const [agora] = React.useState(() => Date.now());
  const slots = (livres.data?.slots ?? []).filter((s) => new Date(s.inicio).getTime() > agora);

  const nomeDoDia = (d: Dia, i: number) => {
    if (aPartirDe + i === 0) return t("Hoje");
    if (aPartirDe + i === 1) return t("Amanhã");
    return new Intl.DateTimeFormat(tag, {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(d.ano, d.mes - 1, d.dia, 12)));
  };

  return (
    <div className="grid gap-4">
      <div
        ref={fileira}
        className="flex gap-2 overflow-x-auto pb-1"
        role="group"
        aria-label={t("Dia")}
      >
        {dias.map((d, i) => (
          <Button
            key={`${d.ano}-${d.mes}-${d.dia}`}
            type="button"
            size="sm"
            variant={i === diaEscolhido ? "primary" : "outline"}
            aria-pressed={i === diaEscolhido}
            onClick={() => {
              setDiaEscolhido(i);
              aoEscolher(null);
            }}
            className="shrink-0"
          >
            {nomeDoDia(d, i)}
          </Button>
        ))}
      </div>
      <div className="min-h-16" aria-live="polite">
        {livres.isLoading ? (
          <p className="text-sm text-text-muted">{t("Procurando horários livres…")}</p>
        ) : livres.data && !livres.data.publicou_horarios ? (
          <p className="text-sm text-text-muted">
            {t("Este profissional ainda não publicou os horários de atendimento.")}
          </p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum horário livre neste dia.")}</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("Horários livres")}>
            {slots.map((s) => (
              <Button
                key={s.inicio}
                type="button"
                size="sm"
                variant={slot === s.inicio ? "primary" : "outline"}
                aria-pressed={slot === s.inicio}
                onClick={() => aoEscolher(s.inicio)}
                className="tabular-nums"
              >
                {horaNoFuso(s.inicio, fuso, tag)}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Remarcar ────────────────────────────────────────────────────────────────

export function JanelaRemarcar({
  sessao,
  fuso,
  aberta,
  aoFechar,
}: {
  sessao: SessaoDaGrade;
  fuso: string;
  aberta: boolean;
  aoFechar: () => void;
}) {
  const t = useT();
  const recarregar = useRecarregarBalcao();
  const remarcar = useRemarcarAgendamento();
  const [slot, setSlot] = React.useState<string | null>(null);

  async function confirmar() {
    if (!slot) return;
    await remarcar.mutateAsync({ id: sessao.id, starts_at: slot });
    recarregar();
    aoFechar();
  }

  const paciente = sessao.paciente ? primeiroNome(sessao.paciente.nome) : sessao.titulo;
  return (
    <Dialog open={aberta} onOpenChange={(o) => (!o ? aoFechar() : undefined)}>
      <DialogContent className="max-w-lg" data-testid="janela-remarcar">
        <DialogHeader>
          <DialogTitle>{t("Remarcar {nome}").replace("{nome}", paciente)}</DialogTitle>
          <DialogDescription>
            {t("Escolha o dia e um horário livre. A sessão muda para o novo horário.")}
          </DialogDescription>
        </DialogHeader>
        {!sessao.tipo ? (
          <p className="text-sm text-text-muted">
            {t("Este horário não tem tipo de atendimento. Remarque pela Agenda.")}
          </p>
        ) : (
          <EscolhaDeHorario
            sessao={sessao}
            fuso={fuso}
            aberta={aberta}
            aPartirDe={0}
            diaInicial={0}
            slot={slot}
            aoEscolher={setSlot}
          />
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            {t("Voltar")}
          </Button>
          <Button
            onClick={() => void confirmar().catch(() => undefined)}
            disabled={!slot || remarcar.isPending}
            data-testid="confirmar-remarcar"
          >
            {t("Remarcar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Marcar a próxima ────────────────────────────────────────────────────────

/**
 * Marca a próxima sessão do mesmo paciente, com o mesmo profissional e o mesmo tipo, sem sair do
 * atendimento. A fileira começa amanhã e já abre no dia `diasAteASugerida` (uma semana, por
 * padrão), que é como a clínica costuma manter o tratamento.
 */
export function JanelaProximaSessao({
  sessao,
  fuso,
  aberta,
  diasAteASugerida,
  aoFechar,
}: {
  sessao: SessaoDaGrade;
  fuso: string;
  aberta: boolean;
  diasAteASugerida: number;
  aoFechar: () => void;
}) {
  const t = useT();
  const recarregar = useRecarregarBalcao();
  const marcar = useMarcarAgendamento();
  const [slot, setSlot] = React.useState<string | null>(null);

  async function confirmar() {
    if (!slot || !sessao.tipo) return;
    await marcar.mutateAsync({
      event_type_id: sessao.tipo.id,
      starts_at: slot,
      ...(sessao.profissional_user_id ? { owner_user_id: sessao.profissional_user_id } : {}),
      ...(sessao.paciente ? { contact_id: sessao.paciente.id } : {}),
    });
    recarregar();
    aoFechar();
  }

  const paciente = sessao.paciente ? primeiroNome(sessao.paciente.nome) : sessao.titulo;
  return (
    <Dialog open={aberta} onOpenChange={(o) => (!o ? aoFechar() : undefined)}>
      <DialogContent className="max-w-lg" data-testid="janela-proxima-sessao">
        <DialogHeader>
          <DialogTitle>{t("Próxima sessão de {nome}").replace("{nome}", paciente)}</DialogTitle>
          <DialogDescription>
            {t("Mesmo tipo de atendimento e mesmo profissional. Escolha o dia e um horário livre.")}
          </DialogDescription>
        </DialogHeader>
        {!sessao.tipo ? (
          <p className="text-sm text-text-muted">
            {t("Este horário não tem tipo de atendimento. Marque pela Agenda.")}
          </p>
        ) : (
          <EscolhaDeHorario
            sessao={sessao}
            fuso={fuso}
            aberta={aberta}
            aPartirDe={1}
            diaInicial={Math.max(0, diasAteASugerida - 1)}
            slot={slot}
            aoEscolher={setSlot}
          />
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            {t("Voltar")}
          </Button>
          <Button
            onClick={() => void confirmar().catch(() => undefined)}
            disabled={!slot || marcar.isPending}
            data-testid="confirmar-proxima-sessao"
          >
            {t("Marcar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Cancelar ────────────────────────────────────────────────────────────────

interface RespostaDoCancelamento {
  multa: { valor_cents: number | null; percentual: number } | null;
}

export function JanelaCancelar({
  sessao,
  politica,
  precoCents,
  aberta,
  aoFechar,
}: {
  sessao: SessaoDaGrade;
  politica: PoliticaDaAgenda;
  precoCents: number | null;
  aberta: boolean;
  aoFechar: () => void;
}) {
  const t = useT();
  const moeda = moedaServidaOu(useActiveOrg()?.currency);
  const dinheiro = (cents: number) => formatCents(cents, moeda);
  const recarregar = useRecarregarBalcao();
  const [pelaClinica, setPelaClinica] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const previa = previaDaMulta({ sessao, agora: new Date(), politica, precoCents, pelaClinica });

  const cancelar = useMutation({
    mutationFn: async () =>
      apiClient.post<{ data: RespostaDoCancelamento }>(
        `/api/v1/clinica/agenda/${sessao.id}/cancelar`,
        { motivo: motivo.trim(), pela_clinica: pelaClinica },
      ),
    onSuccess: (r) => {
      const multa = r.data.multa;
      toast.success(
        multa
          ? multa.valor_cents != null
            ? t("Sessão cancelada. Multa de {valor} lançada.").replace(
                "{valor}",
                dinheiro(multa.valor_cents),
              )
            : t("Sessão cancelada. Multa de {pct}% lançada.").replace(
                "{pct}",
                String(multa.percentual),
              )
          : t("Sessão cancelada sem custo."),
      );
      recarregar();
      aoFechar();
    },
    onError: (err) => showApiError(err),
  });

  const paciente = sessao.paciente ? primeiroNome(sessao.paciente.nome) : sessao.titulo;
  const motivoValido = motivo.trim().length >= 3;
  return (
    <Dialog open={aberta} onOpenChange={(o) => (!o ? aoFechar() : undefined)}>
      <DialogContent className="max-w-lg" data-testid="janela-cancelar">
        <DialogHeader>
          <DialogTitle>{t("Cancelar a sessão de {nome}").replace("{nome}", paciente)}</DialogTitle>
          <DialogDescription>{t("O horário fica livre e a equipe vê o motivo.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-sm text-text-muted">{t("Quem pediu o cancelamento")}</span>
            <div className="flex gap-2" role="group">
              <Button
                type="button"
                size="sm"
                variant={!pelaClinica ? "primary" : "outline"}
                aria-pressed={!pelaClinica}
                onClick={() => setPelaClinica(false)}
              >
                {t("O paciente")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={pelaClinica ? "primary" : "outline"}
                aria-pressed={pelaClinica}
                onClick={() => setPelaClinica(true)}
              >
                {t("A clínica")}
              </Button>
            </div>
          </div>
          <div
            data-testid="previa-da-multa"
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              previa
                ? "border-warning-fg/40 bg-warning-bg text-warning-fg"
                : "border-border bg-surface",
            )}
          >
            {previa
              ? previa.valor_cents != null
                ? t(
                    "Cancelamento com menos de {horas} horas: multa de {pct}%, {valor}. A multa é cobrada no próximo pagamento.",
                  )
                    .replace("{horas}", String(politica.antecedencia_cancelamento_horas))
                    .replace("{pct}", String(previa.percentual))
                    .replace("{valor}", dinheiro(previa.valor_cents))
                : t(
                    "Cancelamento com menos de {horas} horas: multa de {pct}% do valor da sessão. A multa é cobrada no próximo pagamento.",
                  )
                    .replace("{horas}", String(politica.antecedencia_cancelamento_horas))
                    .replace("{pct}", String(previa.percentual))
              : pelaClinica
                ? t("A clínica desmarcou: sem custo para o paciente.")
                : t("Sem multa: o aviso veio com antecedência.")}
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="text-text-muted">{t("Motivo")}</span>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={t("Ex.: o paciente avisou pelo WhatsApp que está doente")}
              maxLength={500}
              data-testid="motivo-do-cancelamento"
            />
          </label>
          {previa ? (
            <p className="text-xs text-text-muted">
              {t(
                "Com atestado ou motivo aceito, a multa pode ser isentada depois na ficha do paciente.",
              )}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            {t("Voltar")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => cancelar.mutate()}
            disabled={!motivoValido || cancelar.isPending}
            data-testid="confirmar-cancelar"
          >
            {t("Cancelar a sessão")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

export function JanelaWhatsApp({
  sessao,
  fuso,
  nomeDoProfissional,
  aberta,
  aoFechar,
}: {
  sessao: SessaoDaGrade;
  fuso: string;
  nomeDoProfissional: string | null;
  aberta: boolean;
  aoFechar: () => void;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const paciente = sessao.paciente;
  const nome = paciente ? primeiroNome(paciente.nome) : "";
  const hora = horaNoFuso(sessao.inicio, fuso, tag);
  const tipo = (sessao.tipo?.nome ?? sessao.titulo).toLocaleLowerCase(tag);
  const com = nomeDoProfissional ? primeiroNome(nomeDoProfissional) : null;

  const modelos = React.useMemo(
    () => [
      {
        rotulo: t("Lembrete"),
        texto: (com
          ? t(
              "Oi, {nome}! Passando para lembrar da sua {tipo} hoje às {hora} com {com}. Pode confirmar?",
            )
          : t("Oi, {nome}! Passando para lembrar da sua {tipo} hoje às {hora}. Pode confirmar?")
        )
          .replace("{nome}", nome)
          .replace("{tipo}", tipo)
          .replace("{hora}", hora)
          .replace("{com}", com ?? ""),
      },
      {
        rotulo: t("Estamos esperando"),
        texto: t("Oi, {nome}! Estamos te esperando. Está a caminho?").replace("{nome}", nome),
      },
      {
        rotulo: t("Remarcar"),
        texto: t(
          "Oi, {nome}! Precisamos remarcar sua {tipo} de hoje às {hora}. Qual horário fica bom para você?",
        )
          .replace("{nome}", nome)
          .replace("{tipo}", tipo)
          .replace("{hora}", hora),
      },
    ],
    [t, nome, tipo, hora, com],
  );
  // A janela é montada a cada abertura, então o texto sempre começa no primeiro modelo.
  const [texto, setTexto] = React.useState(modelos[0]!.texto);

  const enviar = useMutation({
    mutationFn: async () => {
      if (!paciente?.telefone) throw new Error(t("O contato não tem telefone cadastrado."));
      const conversa = await apiClient.post<{ data: { conversation_id: string } }>(
        "/api/v1/conversations/open-with-contact",
        { contact_id: paciente.id, phone_number: paciente.telefone },
      );
      return apiClient.post("/api/v1/messages", {
        conversation_id: conversa.data.conversation_id,
        body: texto.trim(),
      });
    },
    onSuccess: () => {
      toast.success(t("Mensagem enviada para {nome}.").replace("{nome}", nome));
      aoFechar();
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Dialog open={aberta} onOpenChange={(o) => (!o ? aoFechar() : undefined)}>
      <DialogContent className="max-w-lg" data-testid="janela-whatsapp">
        <DialogHeader>
          <DialogTitle>{t("WhatsApp para {nome}").replace("{nome}", nome)}</DialogTitle>
          <DialogDescription>
            {t("Sai pelo número da clínica e fica na conversa do paciente.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("Respostas rápidas")}>
            {modelos.map((m) => (
              <Button
                key={m.rotulo}
                type="button"
                size="sm"
                variant={texto === m.texto ? "primary" : "outline"}
                aria-pressed={texto === m.texto}
                onClick={() => setTexto(m.texto)}
              >
                {m.rotulo}
              </Button>
            ))}
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="text-text-muted">{t("Mensagem")}</span>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              data-testid="texto-do-whatsapp"
            />
          </label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={aoFechar}>
            {t("Voltar")}
          </Button>
          <Button
            onClick={() => enviar.mutate()}
            disabled={texto.trim().length === 0 || enviar.isPending}
            data-testid="enviar-whatsapp"
          >
            {t("Enviar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
