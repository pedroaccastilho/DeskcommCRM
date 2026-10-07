import Link from "next/link";

/**
 * Uma tela da versão atual montada dentro da interface nova (`lib/novo/ajustes.ts`): o caminho de
 * volta para os Ajustes e a página de lá, com a paleta daqui (`.n-vestida` + `.n-ajuste` em
 * `novo.css`). A página traz os próprios portões de papel; esta casca não decide acesso.
 */
export function CascaDoAjuste({ children }: { children: React.ReactNode }) {
  return (
    <div className="n-conteudo max-w-6xl" data-testid="novo-ajuste">
      <Link href="/ajustes" className="n-suave text-sm font-semibold">
        ‹ Ajustes
      </Link>
      <div className="n-vestida n-ajuste mt-3">{children}</div>
    </div>
  );
}
