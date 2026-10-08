"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { enderecoNaInterfaceNova } from "@/lib/novo/ajustes";

/**
 * Uma tela da versão atual montada dentro da interface nova (`lib/novo/ajustes.ts`): o caminho de
 * volta para os Ajustes e a página de lá, com a paleta daqui (`.n-vestida` + `.n-ajuste` em
 * `novo.css`). A página traz os próprios portões de papel; esta casca não decide acesso.
 *
 * Os links da página de lá apontam para `/app/...`. Um clique num deles que tenha tela equivalente
 * aqui (o quadro de um funil, um negócio, um agente) fica na interface nova; o resto segue para a
 * versão atual. Clique com Ctrl, Cmd, Shift ou o botão do meio continua sendo do navegador.
 */
export function CascaDoAjuste({ children }: { children: React.ReactNode }) {
  const router = useRouter();

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
        {children}
      </div>
    </div>
  );
}
