"use client";

/**
 * A lista dos Ajustes (`/ajustes`): os grupos do catálogo, com busca. O que já tem casa na
 * interface nova abre aqui; o resto abre na versão atual, e o cartão diz isso antes do clique.
 */
import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useT } from "@/hooks/i18n/useT";
import { MagnifyingGlass } from "@/lib/ui/icons";

export interface ItemDeAjuste {
  href: string;
  naNova: boolean;
  rotulo: string;
  descricao: string;
}

export interface GrupoDeAjustes {
  titulo: string;
  secoes: { titulo: string; itens: ItemDeAjuste[] }[];
}

function normal(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ListaDeAjustes({
  grupos,
  titulo,
  subtitulo,
}: {
  grupos: GrupoDeAjustes[];
  /** A Gestão de quem não administra usa a mesma lista, com o próprio nome. */
  titulo?: string;
  subtitulo?: string;
}) {
  const t = useT();
  const [termo, setTermo] = useState("");
  const filtrados = useMemo(() => {
    const busca = normal(termo.trim());
    if (!busca) return grupos;
    return grupos
      .map((g) => ({
        ...g,
        secoes: g.secoes
          .map((s) => ({
            ...s,
            itens: s.itens.filter((i) => normal(`${i.rotulo} ${i.descricao}`).includes(busca)),
          }))
          .filter((s) => s.itens.length > 0),
      }))
      .filter((g) => g.secoes.length > 0);
  }, [grupos, termo]);

  return (
    <div className="n-conteudo max-w-5xl" data-testid="novo-ajustes">
      <div className="n-entra">
        <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">
          {titulo ?? t("Ajustes")}
        </h1>
        <p className="n-suave mt-1">
          {subtitulo ?? t("Tudo o que o administrador configura na clínica.")}
        </p>
      </div>
      <div className="n-entra relative mt-6">
        <input
          className="n-campo !min-h-[56px] !rounded-[22px] !bg-[var(--n-cartao)] !pl-14 shadow-[var(--n-sombra)]"
          placeholder={t("Buscar um ajuste")}
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          aria-label={t("Buscar um ajuste")}
          data-testid="novo-ajustes-busca"
        />
        <MagnifyingGlass
          size={22}
          className="n-fraco pointer-events-none absolute top-1/2 left-5 -translate-y-1/2"
          aria-hidden
        />
      </div>

      {filtrados.length === 0 && (
        <p className="n-suave mt-8 text-center">{t("Nenhum ajuste com esse nome.")}</p>
      )}

      {filtrados.map((g) => (
        <section key={g.titulo} className="mt-9">
          <h2 className="n-titulo text-2xl">{g.titulo}</h2>
          {g.secoes.map((s) => (
            <div key={s.titulo || g.titulo} className="mt-3">
              {s.titulo && (
                <p className="n-fraco mb-2 text-xs font-semibold uppercase">{s.titulo}</p>
              )}
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.itens.map((i) => (
                  <li key={i.href}>
                    <CartaoDoAjuste item={i} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function CartaoDoAjuste({ item }: { item: ItemDeAjuste }) {
  const t = useT();
  const corpo = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="font-semibold">{item.rotulo}</span>
        {!item.naNova && <span className="n-selo shrink-0 text-[11px]">{t("versão atual")}</span>}
      </span>
      <span className="n-suave mt-1 block text-sm">{item.descricao}</span>
    </>
  );
  const classe = "n-cartao n-cartao-link block h-full p-4";
  // A versão atual é outra casca: navegação inteira, não do roteador da nova.
  return item.naNova ? (
    <Link href={item.href as Route} className={classe} data-testid="novo-ajuste-item">
      {corpo}
    </Link>
  ) : (
    <a href={item.href} className={classe} data-testid="novo-ajuste-item">
      {corpo}
    </a>
  );
}
