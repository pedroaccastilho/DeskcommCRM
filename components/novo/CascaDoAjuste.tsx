"use client";

import type { Route } from "next";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { enderecoNaInterfaceNova } from "@/lib/novo/ajustes";

/**
 * Uma tela da versão atual montada dentro da interface nova (`lib/novo/ajustes.ts`): o caminho de
 * volta para os Ajustes e a página de lá, com a paleta daqui (`.n-vestida` + `.n-ajuste` em
 * `novo.css`). A página traz os próprios portões de papel; esta casca não decide acesso.
 *
 * Os links da página de lá apontam para `/app/...`. Um clique num deles que tenha tela equivalente
 * aqui (o quadro de um funil, um negócio, um agente) fica na interface nova; o resto segue para a
 * versão atual. Clique com Ctrl, Cmd, Shift ou o botão do meio continua sendo do navegador.
 *
 * O mesmo vale para a navegação que a página de lá faz sozinha (`router.push` depois de criar uma
 * campanha, `router.replace` ao limpar a busca): ela recebe aqui um roteador que traduz o endereço
 * antes de navegar, então quem salva um agente continua na interface nova.
 */
export function CascaDoAjuste({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const roteador = useMemo<typeof router>(
    () => ({
      ...router,
      push: (href, opcoes) => router.push(traduzir(href), opcoes),
      replace: (href, opcoes) => router.replace(traduzir(href), opcoes),
      prefetch: (href, opcoes) => router.prefetch(traduzir(href), opcoes),
    }),
    [router],
  );

  function aoClicar(e: React.MouseEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const link = (e.target as HTMLElement).closest("a[href]");
    if (!link || (link.getAttribute("target") ?? "_self") !== "_self") return;
    const destino = enderecoNaInterfaceNova(link.getAttribute("href") ?? "");
    if (!destino) return;
    e.preventDefault();
    e.stopPropagation();
    router.push(destino as Route);
  }

  return (
    <div className="n-conteudo max-w-6xl" data-testid="novo-ajuste">
      <Link href="/ajustes" className="n-suave text-sm font-semibold">
        ‹ Ajustes
      </Link>
      <div className="n-vestida n-ajuste mt-3" onClickCapture={aoClicar}>
        <AppRouterContext.Provider value={roteador}>{children}</AppRouterContext.Provider>
      </div>
    </div>
  );
}

function traduzir(href: string): Route {
  return (enderecoNaInterfaceNova(href) ?? href) as Route;
}
