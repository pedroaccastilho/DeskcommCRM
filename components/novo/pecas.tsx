"use client";

/** As peças pequenas da interface nova: avatar, folha, seção, estado vazio e formatos de hora. */
import * as Dialog from "@radix-ui/react-dialog";
import * as React from "react";

import { corDaModalidade } from "@/lib/clinica/cores-da-agenda";
import type { Modalidade } from "@/lib/clinica/vocabulario";

/** Cores calmas para o avatar, escolhidas pelo nome (estáveis entre uma visita e outra). */
const TONS = ["#e8d8c3", "#d5e3d4", "#dcd6ea", "#f0d5cc", "#d3e1e8", "#ebe0b8", "#e4d3df"];

function tomDo(nome: string): string {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONS[h % TONS.length]!;
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0]!.charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1]!.charAt(0) : "";
  return (primeira + ultima).toUpperCase();
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

export function Avatar({
  nome,
  tamanho = 40,
  claro = false,
}: {
  nome: string;
  tamanho?: number;
  claro?: boolean;
}) {
  return (
    <span
      className="n-avatar"
      aria-hidden
      style={{
        width: tamanho,
        height: tamanho,
        fontSize: Math.round(tamanho * 0.38),
        background: claro ? "var(--n-papel)" : tomDo(nome),
      }}
    >
      {iniciais(nome)}
    </span>
  );
}

export function PontoDaModalidade({ modalidade }: { modalidade: Modalidade | null }) {
  return (
    <span className="n-ponto" style={{ background: corDaModalidade(modalidade) }} aria-hidden />
  );
}

/**
 * A FOLHA: sobe de baixo no celular e abre à direita no computador. É o único tipo de janela da
 * interface nova — uma coisa por vez, sempre com o botão principal embaixo.
 */
export function Folha({
  aberta,
  aoFechar,
  titulo,
  subtitulo,
  children,
  testid,
}: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: React.ReactNode;
  subtitulo?: React.ReactNode;
  children: React.ReactNode;
  testid?: string;
}) {
  // O portal desenha dentro da casca para herdar a paleta e as fontes da interface nova.
  // O portal só monta com a folha aberta, sempre no navegador.
  const raiz =
    aberta && typeof document !== "undefined"
      ? document.querySelector<HTMLElement>('[data-interface="novo"]')
      : null;
  return (
    <Dialog.Root open={aberta} onOpenChange={(o) => (!o ? aoFechar() : undefined)}>
      <Dialog.Portal container={raiz ?? undefined}>
        <Dialog.Overlay className="n-folha-fundo" />
        <Dialog.Content className="n-folha" data-testid={testid}>
          <div className="n-pegador" aria-hidden />
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="n-titulo text-[26px] leading-tight">{titulo}</Dialog.Title>
              {subtitulo ? (
                <Dialog.Description className="n-suave mt-1 text-sm">
                  {subtitulo}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{titulo}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="n-botao n-botao-suave n-botao-pequeno">Fechar</Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Secao({
  titulo,
  contagem,
  acao,
  children,
  tom,
}: {
  titulo: string;
  contagem?: number;
  acao?: React.ReactNode;
  children: React.ReactNode;
  tom?: "alerta" | "aviso";
}) {
  return (
    <section className="n-entra">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          {tom && (
            <span
              className="n-ponto"
              style={{ background: tom === "alerta" ? "var(--n-alerta)" : "var(--n-aviso)" }}
              aria-hidden
            />
          )}
          {titulo}
          {contagem !== undefined && (
            <span className="n-fraco n-numero font-semibold">{contagem}</span>
          )}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function Vazio({ titulo, texto }: { titulo: string; texto?: string }) {
  return (
    <div className="rounded-[var(--n-raio)] border-2 border-dashed border-[var(--n-linha)] px-6 py-10 text-center">
      <p className="n-titulo text-xl">{titulo}</p>
      {texto && <p className="n-suave mx-auto mt-1 max-w-sm text-sm">{texto}</p>}
    </div>
  );
}

export function Carregando({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-[var(--n-raio)] bg-[var(--n-papel-2)]" />
      ))}
    </div>
  );
}

export function hora(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: fuso,
  }).format(new Date(iso));
}

export function horaDecimal(iso: string, fuso: string): number {
  const p = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: fuso,
  }).formatToParts(new Date(iso));
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function dataLonga(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: fuso,
  }).format(new Date(iso));
}

export function dataCurta(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: fuso,
  }).format(new Date(iso));
}

/** O relógio da tela anda sozinho: o "agora" da linha do dia e os prazos mudam sem recarregar. */
export function useAgora(intervaloMs = 30_000): Date {
  const [agora, setAgora] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), intervaloMs);
    return () => window.clearInterval(id);
  }, [intervaloMs]);
  return agora;
}
