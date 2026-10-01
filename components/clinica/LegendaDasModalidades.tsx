"use client";

/**
 * A legenda e a escolha de cores da Agenda — o lado de TELA do módulo clínica.
 *
 * A grade do núcleo pinta por pessoa. Com o módulo instalado, quem olha pode
 * trocar para "por modalidade" (`lib/clinica/cores-da-agenda.ts`). A escolha é
 * de cada pessoa e mora no navegador: não é configuração da clínica, é como
 * cada um prefere ler a própria tela — a recepção quer a modalidade, o
 * fisioterapeuta que olha a equipe pode preferir as pessoas.
 */
import * as React from "react";

import { useT } from "@/hooks/i18n/useT";
import { corDaModalidade, MODALIDADES_DA_LEGENDA } from "@/lib/clinica/cores-da-agenda";
import { ROTULO_DA_MODALIDADE } from "@/lib/clinica/vocabulario";

export type CoresDaAgenda = "modalidade" | "profissional";

const CHAVE = "toq.agenda.cores";

/** Avisa quem lê quando a escolha muda nesta aba (o evento `storage` só cobre as outras). */
const ouvintes = new Set<() => void>();

function lerEscolha(): CoresDaAgenda {
  try {
    const salvo = window.localStorage.getItem(CHAVE);
    return salvo === "profissional" ? "profissional" : "modalidade";
  } catch {
    // janela privada ou armazenamento bloqueado: segue o padrão
    return "modalidade";
  }
}

function assinar(aviso: () => void): () => void {
  ouvintes.add(aviso);
  window.addEventListener("storage", aviso);
  return () => {
    ouvintes.delete(aviso);
    window.removeEventListener("storage", aviso);
  };
}

/**
 * "modalidade" no servidor e na hidratação, a escolha salva depois — sem
 * divergência entre o HTML do servidor e o primeiro render do cliente.
 */
export function useCoresDaAgenda(): [CoresDaAgenda, (c: CoresDaAgenda) => void] {
  const cores = React.useSyncExternalStore(assinar, lerEscolha, () => "modalidade" as const);
  const escolher = React.useCallback((c: CoresDaAgenda) => {
    try {
      window.localStorage.setItem(CHAVE, c);
    } catch {
      // sem armazenamento: a escolha não persiste
    }
    ouvintes.forEach((aviso) => aviso());
  }, []);
  return [cores, escolher];
}

/** Cor nunca é a única informação: a legenda diz o que cada uma quer dizer. */
export function LegendaDasModalidades() {
  const t = useT();
  const itens = [
    ...MODALIDADES_DA_LEGENDA.map((m) => ({
      chave: m,
      rotulo: t(ROTULO_DA_MODALIDADE[m]),
      cor: corDaModalidade(m),
    })),
    { chave: "outra", rotulo: t("Outros"), cor: corDaModalidade(null) },
  ];
  return (
    <ul
      data-testid="legenda-das-modalidades"
      aria-label={t("Modalidade")}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted"
    >
      {itens.map((i) => (
        <li key={i.chave} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: i.cor }}
          />
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}
