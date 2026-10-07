/**
 * OS ENDEREÇOS da interface nova (Pedro, 2026-10-04: "pode até remover do path da URL o /novo").
 *
 * A interface nova é a principal de quem não administra, então as telas dela moram na raiz:
 * `/hoje`, `/agenda`, `/pacientes`… (`app/(nova)/`, um grupo de rotas que não entra na URL). O
 * "Hoje" ganhou nome próprio porque a raiz `/` só manda para `/app`.
 *
 * Os endereços antigos (`/novo`, `/novo/agenda`…) continuam abrindo: `next.config.ts` os
 * redireciona para estes, com a mesma busca (`?id=` da conversa). Favorito e link de mensagem
 * antigos não viram 404.
 *
 * Módulo puro: o `proxy.ts` (Edge) e o `next.config.ts` o leem.
 */
export const TELAS_DA_INTERFACE_NOVA = [
  "hoje",
  "agenda",
  "pacientes",
  "whatsapp",
  "tarefas",
  "relatorios",
  "equipe",
  "conta",
] as const;

/** O caminho é de uma tela da interface nova (`/agenda`, `/pacientes/<id>`…)? */
export function ehDaInterfaceNova(caminho: string): boolean {
  return TELAS_DA_INTERFACE_NOVA.some((t) => caminho === `/${t}` || caminho.startsWith(`/${t}/`));
}

/** Os redirecionamentos dos endereços antigos, no formato de `redirects()` do Next. */
export function redirecionamentosDoNovo() {
  const telas = TELAS_DA_INTERFACE_NOVA.filter((t) => t !== "hoje").join("|");
  return [
    { source: "/novo", destination: "/hoje", permanent: false },
    { source: `/novo/:tela(${telas})/:resto*`, destination: "/:tela/:resto*", permanent: false },
  ];
}
