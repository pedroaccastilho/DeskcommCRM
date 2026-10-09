/**
 * OS AJUSTES DO ADMINISTRADOR na interface nova (Pedro, 2026-10-04: "posteriormente, ter tudo até
 * dos administradores no novo layout").
 *
 * `/ajustes` é o inventário: toda tela que o catálogo de navegação (`lib/navigation/catalogo.ts`)
 * deixa a pessoa ver, agrupada como no menu da versão atual. Cada uma abre na interface nova
 * quando já tem casa aqui, e na versão atual enquanto não tem — com o aviso escrito no cartão.
 *
 * As telas de `AJUSTES_NA_INTERFACE_NOVA` são as da versão atual montadas dentro da casca nova
 * (`app/(nova)/ajustes/*`): a MESMA página, dentro dos MESMOS layouts do caminho de lá (são eles
 * que recusam a tela com o módulo ou a capacidade desligado), com os mesmos portões de papel e as
 * mesmas ações, só com a paleta daqui. Migrar uma tela é acrescentar uma linha aqui e uma página
 * lá; `ajustes.test.ts` cobra a página, os layouts e que nenhuma tela do catálogo fique de fora.
 */
import { destinoNaInterfaceNova } from "./raiz";

export const AJUSTES_NA_INTERFACE_NOVA = {
  "/app/settings/tenant": "/ajustes/empresa",
  "/app/settings/tenant/clinica": "/ajustes/clinica",
  "/app/settings/tenant/clinica/regras": "/ajustes/clinica/regras",
  "/app/settings/tenant/clinica/chatbot": "/ajustes/clinica/chatbot",
  "/app/settings/tenant/agenda": "/ajustes/agenda",
  "/app/settings/tenant/financeiro": "/ajustes/financeiro",
  "/app/settings/marca": "/ajustes/marca",
  "/app/settings/tags": "/ajustes/etiquetas",
  "/app/connections": "/ajustes/conexoes",
  "/app/audit": "/ajustes/auditoria",
  "/app/lgpd/requests": "/ajustes/lgpd",
  "/app/prospecting": "/ajustes/prospeccao",
  "/app/radar": "/ajustes/radar",
  "/app/templates": "/ajustes/respostas-rapidas",
  "/app/kanban": "/funis",
  "/app/campaigns": "/ajustes/campanhas",
  "/app/companies": "/ajustes/crm/empresas",
  "/app/people": "/ajustes/crm/pessoas",
  "/app/calls": "/ajustes/chamadas",
  "/app/products": "/ajustes/produtos",
  "/app/imports": "/ajustes/importacoes",
  "/app/proposals": "/ajustes/propostas",
  "/app/settings/tenant/proposals": "/ajustes/propostas/configuracao",
  "/app/settings/tenant/proposals/modelos": "/ajustes/propostas/modelos",
  "/app/comandas": "/ajustes/comandas",
  "/app/settings/tenant/pipelines": "/ajustes/etapas-do-funil",
  "/app/ai/agents": "/ajustes/ia/agentes",
  "/app/ai/followups": "/ajustes/ia/follow-ups",
  "/app/ai/atendimento": "/ajustes/ia/atendimento",
  "/app/ai/routers": "/ajustes/ia/roteadores",
  "/app/ai/credentials": "/ajustes/ia/credenciais",
  "/app/ai/providers": "/ajustes/ia/provedores",
  "/app/ai/knowledge/sources": "/ajustes/ia/conhecimento",
  "/app/ai/memory": "/ajustes/ia/memoria",
  "/app/ai/skills": "/ajustes/ia/skills",
  "/app/ai/cases": "/ajustes/ia/casos",
  "/app/ai/inbox": "/ajustes/ia/alertas",
  "/app/ai/cases/avisos": "/ajustes/ia/avisos",
  "/app/ai/proposals": "/ajustes/ia/propostas",
  "/app/ai/runs": "/ajustes/ia/execucoes",
  "/app/ai/usage": "/ajustes/ia/uso",
  "/app/ai/evolution": "/ajustes/ia/evolucao",
  "/app/integrations/nuvemshop": "/ajustes/canais/nuvemshop",
  "/app/webhooks": "/ajustes/canais/webhooks",
  "/app/faturamento": "/ajustes/faturamento",
  "/app/honorarios": "/ajustes/honorarios",
  "/app/metrics": "/ajustes/desempenho",
  "/app/ads/meta": "/ajustes/meta-ads",
  "/app/activities": "/ajustes/atividades",
  "/app/settings/atendimento": "/ajustes/distribuicao",
  "/app/settings/recursos": "/ajustes/recursos",
  "/app/settings/conversoes": "/ajustes/conversoes",
  "/app/settings/meta-ads": "/ajustes/meta-ads/conta",
  "/app/settings/billing": "/ajustes/plano",
  "/app/settings/api-tokens": "/ajustes/api-tokens",
  "/app/settings/voip-trunk": "/ajustes/trunk-sip",
  "/app/extensions": "/ajustes/extensoes",
  "/app/integracao-dados": "/ajustes/integracao-de-dados",
} as const;

/** Onde uma tela do catálogo abre para quem está na interface nova, e se já é aqui. */
export function enderecoDoAjuste(href: string): { href: string; naNova: boolean } {
  const ajuste = (AJUSTES_NA_INTERFACE_NOVA as Record<string, string>)[href];
  if (ajuste) return { href: ajuste, naNova: true };
  if (href === "/app/team") return { href: "/equipe", naNova: true };
  const dia = destinoNaInterfaceNova(href);
  if (dia) return { href: dia, naNova: true };
  return { href, naNova: false };
}

/**
 * As telas de DETALHE que as listas acima abrem (o quadro de um funil, um negócio, um agente), no
 * mesmo esquema. `[id]` e `[slug]` casam um segmento do caminho; a ordem importa (a mais
 * específica antes), como nas rotas.
 */
export const DETALHES_NA_INTERFACE_NOVA: readonly (readonly [string, string])[] = [
  ["/app/extensions/[id]", "/ajustes/extensoes/[id]"],
  ["/app/ai/agents/new", "/ajustes/ia/agentes/novo"],
  ["/app/ai/agents/[id]", "/ajustes/ia/agentes/[id]"],
  ["/app/ai/atendimento/[id]", "/ajustes/ia/atendimento/[id]"],
  ["/app/ai/routers/[id]", "/ajustes/ia/roteadores/[id]"],
  ["/app/ai/followups/enrollments/[id]", "/ajustes/ia/follow-ups/inscricao/[id]"],
  ["/app/ai/followups/[id]", "/ajustes/ia/follow-ups/[id]"],
  ["/app/companies/[id]", "/ajustes/crm/empresas/[id]"],
  ["/app/people/[id]", "/ajustes/crm/pessoas/[id]"],
  ["/app/pipelines/[id]", "/funis/[id]"],
  ["/app/leads/[id]", "/leads/[id]"],
  ["/app/integracao-dados/[id]", "/ajustes/integracao-de-dados/[id]"],
  ["/app/settings/tenant/proposals/modelos/[slug]", "/ajustes/propostas/modelos/[slug]"],
  ["/app/imports/[id]", "/ajustes/importacoes/[id]"],
  ["/app/proposals/novo", "/ajustes/propostas/nova"],
  ["/app/proposals/[id]", "/ajustes/propostas/[id]"],
  ["/app/lgpd/requests/[id]", "/ajustes/lgpd/[id]"],
  ["/app/campaigns/new", "/ajustes/campanhas/nova"],
  ["/app/campaigns/[id]/edit", "/ajustes/campanhas/[id]/editar"],
  ["/app/campaigns/[id]", "/ajustes/campanhas/[id]"],
];

function casar(padrao: string, caminho: string): Record<string, string> | null {
  const a = padrao.split("/");
  const b = caminho.split("/");
  if (a.length !== b.length) return null;
  const valores: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const m = a[i]!.match(/^\[(\w+)\]$/);
    if (m) {
      if (!/^[\w-]+$/.test(b[i]!)) return null;
      valores[m[1]!] = b[i]!;
    } else if (a[i] !== b[i]) return null;
  }
  return valores;
}

/**
 * Para onde um link da versão atual leva quem está na interface nova: a tela equivalente daqui
 * (lista, detalhe ou do dia a dia), com a mesma busca; `null` quando não há.
 */
export function enderecoNaInterfaceNova(href: string): string | null {
  if (!href.startsWith("/app") || href.includes("#")) return null;
  const [caminho = "", busca = ""] = href.split("?");
  const p = caminho.replace(/\/+$/, "") || "/";
  const comBusca = (destino: string) =>
    busca ? `${destino}${destino.includes("?") ? "&" : "?"}${busca}` : destino;
  const exato = (AJUSTES_NA_INTERFACE_NOVA as Record<string, string>)[p];
  if (exato) return comBusca(exato);
  for (const [antigo, novo] of DETALHES_NA_INTERFACE_NOVA) {
    const valores = casar(antigo, p);
    if (valores) return comBusca(novo.replace(/\[(\w+)\]/g, (_, k: string) => valores[k]!));
  }
  if (p === "/app/team") return comBusca("/equipe");
  return destinoNaInterfaceNova(p, busca);
}
