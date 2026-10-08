"use client";

/**
 * MINHA CONTA na interface nova: perfil, segurança e avisos de quem está usando. São as telas de
 * `/app/settings/{profile,security,notifications}`, com os MESMOS formulários e as mesmas ações de
 * servidor, vestidas com a paleta da interface nova (`.n-vestida` em `novo.css`). Quem usa só a
 * interface nova não precisa mais da atual para trocar a senha ou o nome.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/hooks/i18n/useT";

export function CascaDaConta({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();
  const abas = [
    { href: "/conta", rotulo: t("Perfil") },
    { href: "/conta/seguranca", rotulo: t("Segurança") },
    { href: "/conta/avisos", rotulo: t("Avisos") },
  ] as const;
  return (
    <div className="n-conteudo max-w-3xl" data-testid="novo-conta">
      <header className="n-entra mb-5">
        <p className="n-fraco text-sm font-semibold">{t("Minha conta")}</p>
        <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">{titulo}</h1>
        <p className="n-suave mt-1">{descricao}</p>
      </header>
      <nav aria-label={t("Minha conta")} className="mb-5 flex flex-wrap gap-2">
        {abas.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            aria-current={pathname === a.href ? "page" : undefined}
            className="n-chip"
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>
      <div className="n-vestida flex flex-col gap-5">{children}</div>
    </div>
  );
}
