"use client";

/**
 * A CASCA da interface nova (`/novo`): o trilho escuro à esquerda no computador, a barra de abas
 * embaixo no celular, e o contexto que toda tela da interface nova lê (cargo, fuso, quem sou).
 *
 * O menu tem no máximo quatro portas, conforme o cargo (`lib/novo/cargo.ts`). Tudo o que não é
 * do dia a dia da clínica fica de fora; o Administrador ganha a porta "Ajustes", que abre as
 * configurações na interface atual.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { showApiError } from "@/components/feedback/ApiErrorToast";
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
  /** O administrador está vendo como outra pessoa ("entrar como"): a tela é só para olhar. */
  soOlhar: boolean;
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
  const eu = useEu();
  // No "entrar como", papel, cadastro e "quem sou eu" são os da pessoa vista (`/api/v1/clinica/eu`).
  const vendoComo = eu.data?.vendo_como ?? null;
  const role: Role = eu.data?.papel ?? activeOrg?.role ?? "viewer";
  const profissional = eu.data?.profissional ?? null;
  const cargoReal = cargoDe(role, profissional);
  const cargos = cargosParaVer(role, cargoReal);

  const escolhido = React.useSyncExternalStore(assinarVisao, lerVisao, () => null);
  const cargo = escolhido && cargos.includes(escolhido) ? escolhido : cargoReal;
  const trocarCargo = gravarVisao;

  const meuNome =
    profissional?.nome_profissional ||
    vendoComo?.nome ||
    user.full_name ||
    user.email.split("@")[0] ||
    "";
  const contexto: Contexto = {
    fuso,
    cargo,
    cargoReal,
    cargos,
    trocarCargo,
    role,
    meuId: vendoComo?.user_id ?? user.id,
    meuNome,
    eu: eu.data,
    modalidades: modalidadesDaVisao(cargo, profissional),
    soAsMinhas: atende(cargo),
    veProntuario: veProntuario(cargo, profissional),
    soOlhar: Boolean(vendoComo),
  };

  const pathname = usePathname() ?? "/novo";
  const menu = menuDoCargo(cargo, veRelatoriosDaGestao(role, eu.data?.cargos ?? []));
  const ativo = (href: string) =>
    href === "/novo" ? pathname === "/novo" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Ctx.Provider value={contexto}>
      <nav className="n-trilho" aria-label="Menu principal">
        <Link href="/novo" className="mb-3 !w-auto !p-0" aria-label={marca.nome}>
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
              href="/novo/equipe"
              className="n-porta"
              aria-current={ativo("/novo/equipe") ? "page" : undefined}
              data-testid="novo-porta-equipe"
            >
              <IdentificationCard size={22} weight={ativo("/novo/equipe") ? "fill" : "regular"} />
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
        {vendoComo && <FaixaDoVerComo nome={vendoComo.nome} />}
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

/**
 * A faixa fixa do "entrar como": de quem é a tela e o caminho de volta, sempre à vista.
 * Voltar recarrega a página para nenhuma tela ficar com dados da visão anterior.
 */
function FaixaDoVerComo({ nome }: { nome: string }) {
  const t = useT();
  const [voltando, setVoltando] = React.useState(false);
  const voltar = async () => {
    setVoltando(true);
    try {
      await apiClient.delete("/api/v1/clinica/ver-como");
      window.location.assign("/novo/equipe");
    } catch (err) {
      setVoltando(false);
      showApiError(err);
    }
  };
  return (
    <div
      role="status"
      className="n-ver-como sticky top-0 z-40 flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
      data-testid="novo-faixa-ver-como"
    >
      <span className="flex-1">
        <strong>{`${t("Você está vendo como")} ${nome}.`}</strong>{" "}
        {t(
          "Só olhar: nada pode ser alterado. O conteúdo clínico só aparece se você também for profissional de saúde.",
        )}
      </span>
      <button
        type="button"
        className="n-botao n-botao-pequeno n-botao-escuro"
        onClick={() => void voltar()}
        disabled={voltando}
        data-testid="novo-voltar-ao-administrador"
      >
        {t("Voltar para o administrador")}
      </button>
    </div>
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
          <div className="border-t border-[var(--n-linha)] pt-2">
            <Link
              href="/novo/tarefas"
              onClick={() => setAberto(false)}
              className="n-linha-clicavel px-2 py-2 text-sm"
              data-testid="novo-menu-tarefas"
            >
              {t("Tarefas")}
            </Link>
            {veConfiguracoes(role) && (
              <Link href="/novo/equipe" className="n-linha-clicavel px-2 py-2 text-sm">
                {t("Equipe")}
              </Link>
            )}
            {veConfiguracoes(role) && (
              <a href="/app/settings" className="n-linha-clicavel px-2 py-2 text-sm">
                {t("Configurações")}
              </a>
            )}
            <a href="/app" className="n-linha-clicavel px-2 py-2 text-sm" data-testid="novo-voltar">
              {t("Voltar para a versão atual")}
            </a>
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
