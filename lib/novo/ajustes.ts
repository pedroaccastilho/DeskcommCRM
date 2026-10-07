/**
 * OS AJUSTES DO ADMINISTRADOR na interface nova (Pedro, 2026-10-04: "posteriormente, ter tudo até
 * dos administradores no novo layout").
 *
 * `/ajustes` é o inventário: toda tela que o catálogo de navegação (`lib/navigation/catalogo.ts`)
 * deixa a pessoa ver, agrupada como no menu da versão atual. Cada uma abre na interface nova
 * quando já tem casa aqui, e na versão atual enquanto não tem — com o aviso escrito no cartão.
 *
 * As telas de `AJUSTES_NA_INTERFACE_NOVA` são as da versão atual montadas dentro da casca nova
 * (`app/(nova)/ajustes/*`): a MESMA página, com os mesmos portões de papel e as mesmas ações, só
 * com a paleta daqui. Migrar uma tela é acrescentar uma linha aqui e uma página lá.
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
