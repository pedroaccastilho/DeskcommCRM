"use client";

/**
 * A CASCA da interface nova: o trilho escuro à esquerda no computador, a barra de abas
 * embaixo no celular, e o contexto que toda tela da interface nova lê (cargo, fuso, quem sou).
 *
 * O menu tem no máximo quatro portas, conforme o cargo (`lib/novo/cargo.ts`). Tudo o que não é
 * do dia a dia da clínica fica de fora; o Administrador ganha a porta "Ajustes", que abre as
 * configurações na interface atual.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { useAuth } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";
import type { Role } from "@/lib/auth/types";
import {
  ROTULO_DO_CARGO,
  atende,
  cargoDe,
  cargosParaVer,
  menuDoCargo,
  modalidadesDaVisao,
  veConfiguracoes,
  veProntuario,
  type Cargo,
  type ItemDoMenu,
} from "@/lib/novo/cargo";
import { useTheme, type Theme } from "@/lib/theme";
import { veRelatoriosDaGestao } from "@/lib/clinica/gestao";
import {
  CalendarBlank,
  ChartBar,
  Gear,
  IdentificationCard,
  Moon,
  Sun,
  UsersThree,
  WhatsappLogo,
} from "@/lib/ui/icons";

import { useEu, type Eu } from "./dados";
import { Avatar } from "./pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";

interface Contexto {
  fuso: string;
  cargo: Cargo;
  cargoReal: Cargo;
  cargos: Cargo[];
  trocarCargo: (c: Cargo) => void;
  role: Role;
  meuId: string;
  meuNome: string;
  eu: Eu | undefined;
  /** Modalidades que a tela mostra (`null` = todas). */
  modalidades: readonly string[] | null;
  /** A interface nova mostra só as sessões de quem está logado? */
  soAsMinhas: boolean;
  /** Prontuário na tela (ler e escrever evolução): profissional ativo, fora da tela da recepção. */
  veProntuario: boolean;
}

const Ctx = React.createContext<Contexto | null>(null);

export function useNovo(): Contexto {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useNovo fora da casca da interface nova");
  return c;
}

const CHAVE_DA_VISAO = "novo:ver-como";

/** A visão escolhida no menu ("ver a tela de"), guardada no navegador de quem escolheu. */
const ouvintesDaVisao = new Set<() => void>();
function assinarVisao(ouvinte: () => void): () => void {
  ouvintesDaVisao.add(ouvinte);
  return () => ouvintesDaVisao.delete(ouvinte);
}
function lerVisao(): Cargo | null {
  try {
    return window.localStorage.getItem(CHAVE_DA_VISAO) as Cargo | null;
  } catch {
    return null; // navegação privada: fica no cargo real
  }
}
function gravarVisao(c: Cargo): void {
  try {
    window.localStorage.setItem(CHAVE_DA_VISAO, c);
  } catch {
    /* idem */
  }
  for (const o of ouvintesDaVisao) o();
}

const ICONE: Record<
  ItemDoMenu["icone"] | "ajustes",
  React.ComponentType<{ size?: number; weight?: "regular" | "fill" | "bold" }>
> = {
  hoje: Sun,
  agenda: CalendarBlank,
  pacientes: UsersThree,
  conversas: WhatsappLogo,
  relatorios: ChartBar,
  ajustes: Gear,
};

export function Casca({
  fuso,
  marca,
  clinicaInstalada,
  children,
}: {
  fuso: string;
  marca: { nome: string; logoUrl: string | null };
  clinicaInstalada: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const { user, activeOrg } = useAuth();
  const role: Role = activeOrg?.role ?? "viewer";
  const eu = useEu();
  const profissional = eu.data?.profissional ?? null;
  const cargoReal = cargoDe(role, profissional);
  const cargos = cargosParaVer(role, cargoReal);

  const escolhido = React.useSyncExternalStore(assinarVisao, lerVisao, () => null);
  const cargo = escolhido && cargos.includes(escolhido) ? escolhido : cargoReal;
  const trocarCargo = gravarVisao;

  const meuNome =
    profissional?.nome_profissional || user.full_name || user.email.split("@")[0] || "";
  const contexto: Contexto = {
    fuso,
    cargo,
    cargoReal,
    cargos,
    trocarCargo,
    role,
    meuId: user.id,
    meuNome,
    eu: eu.data,
    modalidades: modalidadesDaVisao(cargo, profissional),
    soAsMinhas: atende(cargo),
    veProntuario: veProntuario(cargo, profissional),
  };

  const pathname = usePathname() ?? "/hoje";
  const menu = menuDoCargo(cargo, veRelatoriosDaGestao(role, eu.data?.cargos ?? []));
  const ativo = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Ctx.Provider value={contexto}>
      <nav className="n-trilho" aria-label="Menu principal">
        <Link href="/hoje" className="mb-3 !w-auto !p-0" aria-label={marca.nome}>
          <Monograma marca={marca} />
        </Link>
        {menu.map((item) => {
          const Icone = ICONE[item.icone];
          return (
            <Link
              key={item.href}
              href={item.href}
              className="n-porta"
              aria-current={ativo(item.href) ? "page" : undefined}
            >
              <Icone size={22} weight={ativo(item.href) ? "fill" : "regular"} />
              {item.rotulo}
            </Link>
          );
        })}
        <div className="mt-auto flex flex-col items-center gap-1">
          <BotaoDoTema />
          {veConfiguracoes(role) && (
            <Link
              href="/equipe"
              className="n-porta"
              aria-current={ativo("/equipe") ? "page" : undefined}
              data-testid="novo-porta-equipe"
            >
              <IdentificationCard size={22} weight={ativo("/equipe") ? "fill" : "regular"} />
              Equipe
            </Link>
          )}
          {veConfiguracoes(role) && (
            <a
              href="/app/settings"
              className="n-porta"
              title={t("Configurações (abre na versão atual)")}
            >
              <Gear size={22} />
              Ajustes
            </a>
          )}
          <MenuDaPessoa />
        </div>
      </nav>

      <main className="n-palco">
        {clinicaInstalada ? (
          children
        ) : (
          <div className="n-conteudo">
            <div className="n-cartao p-8 text-center">
              <h1 className="n-titulo text-3xl">{t("Falta instalar o módulo clínica")}</h1>
              <p className="n-suave mx-auto mt-3 max-w-md">
                {t(
                  "A interface nova mostra a agenda, os pacientes e o prontuário da clínica. Peça ao administrador para instalar o módulo em Configurações da instalação › Módulos.",
                )}
              </p>
              <a href="/app" className="n-botao n-botao-escuro mt-6">
                {t("Voltar para a versão atual")}
              </a>
            </div>
          </div>
        )}
      </main>

      <nav className="n-abas" aria-label="Menu principal">
        {menu.map((item) => {
          const Icone = ICONE[item.icone];
          return (
            <Link
              key={item.href}
              href={item.href}
              className="n-porta"
              aria-current={ativo(item.href) ? "page" : undefined}
            >
              <Icone size={22} weight={ativo(item.href) ? "fill" : "regular"} />
              {item.rotulo}
            </Link>
          );
        })}
        <MenuDaPessoa compacto />
      </nav>
    </Ctx.Provider>
  );
}

function Monograma({ marca }: { marca: { nome: string; logoUrl: string | null } }) {
  if (marca.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logo vem do storage da instalação
      <img
        src={marca.logoUrl}
        alt={marca.nome}
        className="h-12 w-12 rounded-2xl bg-[var(--n-trilho-tinta)] object-contain p-1.5"
      />
    );
  }
  return (
    <span className="n-titulo grid h-12 w-12 place-items-center rounded-2xl bg-[var(--n-trilho-tinta)] text-xl text-[var(--n-trilho-fundo)]">
      {marca.nome.slice(0, 1)}
    </span>
  );
}

/** O avatar abre o menu da pessoa: ver como outro cargo, voltar para a versão atual, sair. */
function MenuDaPessoa({ compacto = false }: { compacto?: boolean }) {
  const t = useT();
  const { signOut } = useAuth();
  const { meuNome, cargo, cargos, trocarCargo, role } = useNovo();
  const interfaceDaEquipe = useInterfaceDaEquipe();
  const [aberto, setAberto] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  return (
    <div ref={ref} className="relative flex flex-1 md:flex-none">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="menu"
        className="n-porta w-full"
        data-testid="novo-menu-da-pessoa"
      >
        <Avatar nome={meuNome} tamanho={compacto ? 24 : 32} claro />
        {compacto ? t("Você") : ROTULO_DO_CARGO[cargo].split(" ")[0]}
      </button>
      {aberto && (
        <div
          role="menu"
          className={`n-cartao absolute z-50 w-72 p-3 text-[var(--n-tinta)] ${
            compacto ? "right-0 bottom-[calc(100%+14px)]" : "bottom-0 left-[calc(100%+18px)]"
          }`}
        >
          <p className="px-2 pt-1 text-sm font-semibold">{meuNome}</p>
          <p className="n-fraco px-2 pb-2 text-xs">{ROTULO_DO_CARGO[cargo]}</p>
          {cargos.length > 1 && (
            <div className="border-t border-[var(--n-linha)] py-2">
              <p className="n-fraco px-2 pb-1 text-xs font-semibold">Ver a tela de</p>
              {cargos.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitemradio"
                  aria-checked={c === cargo}
                  onClick={() => {
                    trocarCargo(c);
                    setAberto(false);
                  }}
                  className="n-linha-clicavel items-center justify-between px-2 py-2 text-sm"
                >
                  {ROTULO_DO_CARGO[c]}
                  {c === cargo && <span className="n-selo n-selo-ok">{t("agora")}</span>}
                </button>
              ))}
            </div>
          )}
          <EscolhaDoTema />
          {veConfiguracoes(role) && <InterfaceDaEquipe />}
          <div className="border-t border-[var(--n-linha)] pt-2">
            <Link
              href="/conta"
              onClick={() => setAberto(false)}
              className="n-linha-clicavel px-2 py-2 text-sm"
              data-testid="novo-menu-conta"
            >
              {t("Minha conta")}
            </Link>
            <Link
              href="/tarefas"
              onClick={() => setAberto(false)}
              className="n-linha-clicavel px-2 py-2 text-sm"
              data-testid="novo-menu-tarefas"
            >
              {t("Tarefas")}
            </Link>
            {veConfiguracoes(role) && (
              <Link href="/equipe" className="n-linha-clicavel px-2 py-2 text-sm">
                {t("Equipe")}
              </Link>
            )}
            {veConfiguracoes(role) && (
              <a href="/app/settings" className="n-linha-clicavel px-2 py-2 text-sm">
                {t("Configurações")}
              </a>
            )}
            {/* Só o Administrador alterna entre as duas interfaces (Pedro, 2026-10-04): com a
                escolha da organização ligada, para os outros perfis a interface atual leva de
                volta para cá (`lib/novo/raiz.ts`), e a porta sumiria num laço. */}
            {(veConfiguracoes(role) || interfaceDaEquipe.data?.nova_principal === false) && (
              <a href="/app" className="n-linha-clicavel px-2 py-2 text-sm" data-testid="novo-voltar">
                {t("Voltar para a versão atual")}
              </a>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="n-linha-clicavel px-2 py-2 text-sm text-[var(--n-alerta)]"
            >
              Sair
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Um toque troca claro ↔ escuro. O tema é o MESMO da interface atual (`lib/theme`, gravado no
 * navegador): quem escolhe escuro aqui encontra escuro lá também.
 */
function BotaoDoTema() {
  const t = useT();
  const { resolvedTheme, toggle } = useTheme();
  const escuro = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      className="n-porta"
      aria-label={escuro ? t("Usar o tema claro") : t("Usar o tema escuro")}
      data-testid="novo-trocar-tema"
    >
      {escuro ? <Sun size={22} /> : <Moon size={22} />}
      {escuro ? t("Claro") : t("Escuro")}
    </button>
  );
}

const TEMAS: { valor: Theme; rotulo: string }[] = [
  { valor: "light", rotulo: "Claro" },
  { valor: "dark", rotulo: "Escuro" },
  { valor: "system", rotulo: "Automático" },
];

/** No menu da pessoa (o único lugar no celular): claro, escuro ou o que o aparelho usar. */
const CHAVE_DA_INTERFACE = ["clinica", "interface"];

/** A escolha da organização (qualquer membro lê; só o Administrador grava). */
function useInterfaceDaEquipe() {
  return useQuery({
    queryKey: CHAVE_DA_INTERFACE,
    queryFn: async () =>
      (await apiClient.get<{ data: { nova_principal: boolean } }>("/api/v1/clinica/interface"))
        .data,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * A escolha da ORGANIZAÇÃO, só do Administrador: ligada, quem não administra trabalha só na
 * interface nova (a atual leva para cá). Mora em `clinica_politicas` (migration 9010).
 */
function InterfaceDaEquipe() {
  const t = useT();
  const qc = useQueryClient();
  const lida = useInterfaceDaEquipe();
  const gravar = useMutation({
    mutationFn: async (nova_principal: boolean) =>
      (
        await apiClient.put<{ data: { nova_principal: boolean } }>("/api/v1/clinica/interface", {
          nova_principal,
        })
      ).data,
    onSuccess: (d) => qc.setQueryData(CHAVE_DA_INTERFACE, d),
  });
  if (!lida.data) return null;
  const ligada = gravar.isPending ? gravar.variables === true : lida.data.nova_principal;
  return (
    <div className="border-t border-[var(--n-linha)] py-2">
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        disabled={gravar.isPending}
        onClick={() => gravar.mutate(!ligada)}
        className="n-linha-clicavel items-start justify-between gap-3 px-2 py-2 text-left text-sm"
        data-testid="novo-interface-da-equipe"
      >
        <span>
          <span className="block font-semibold">{t("A equipe usa só a interface nova")}</span>
          <span className="n-fraco block text-xs">
            {ligada
              ? t("Ligado: quem não é administrador não vê mais a versão atual.")
              : t("Desligado: a equipe continua na versão atual.")}
          </span>
        </span>
        <span
          aria-hidden
          className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            ligada ? "justify-end bg-[var(--n-acao)]" : "justify-start bg-[var(--n-linha)]"
          }`}
        >
          <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
        </span>
      </button>
      {gravar.isError && (
        <p className="px-2 text-xs text-[var(--n-alerta)]">{t("Não deu para salvar. Tente de novo.")}</p>
      )}
    </div>
  );
}

function EscolhaDoTema() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  return (
    <div className="border-t border-[var(--n-linha)] py-2">
      <p className="n-fraco px-2 pb-1.5 text-xs font-semibold">{t("Aparência")}</p>
      <div className="flex gap-1.5 px-1">
        {TEMAS.map((o) => (
          <button
            key={o.valor}
            type="button"
            className="n-chip flex-1 justify-center"
            aria-pressed={theme === o.valor}
            onClick={() => setTheme(o.valor)}
          >
            {t(o.rotulo)}
          </button>
        ))}
      </div>
    </div>
  );
}
