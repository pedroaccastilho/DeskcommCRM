"use client";

/**
 * PACIENTES: uma busca grande e a lista. Sem colunas, filtros de funil, etiquetas ou importação —
 * isso continua na interface atual para quem precisar.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { useNovo } from "@/components/novo/Casca";
import { useBuscaDePacientes } from "@/components/novo/dados";
import { FolhaDoPaciente } from "@/components/novo/FolhaDoPaciente";
import { Avatar, Carregando, Vazio } from "@/components/novo/pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

export function Pacientes() {
  const t = useT();
  const { cargo, role } = useNovo();
  const router = useRouter();
  const [cadastrar, setCadastrar] = React.useState(false);
  const [termo, setTermo] = React.useState("");
  const [busca, setBusca] = React.useState("");
  React.useEffect(() => {
    const id = window.setTimeout(() => setBusca(termo), 250);
    return () => window.clearTimeout(id);
  }, [termo]);
  const lista = useBuscaDePacientes(busca);
  const rotulo = cargo === "educador" ? "Alunos" : "Pacientes";

  return (
    <div className="n-conteudo max-w-3xl" data-testid="novo-pacientes">
      <div className="n-entra flex flex-wrap items-end justify-between gap-4">
        <h1 className="n-titulo text-[44px] leading-tight sm:text-[52px]">{rotulo}</h1>
        {role !== "viewer" && (
          <button
            type="button"
            className="n-botao n-botao-principal"
            onClick={() => setCadastrar(true)}
            data-testid="novo-cadastrar-paciente"
          >
            + {t("Novo paciente")}
          </button>
        )}
      </div>
      <div className="n-entra relative mt-6">
        <input
          className="n-campo !min-h-[60px] !rounded-[22px] !bg-[var(--n-cartao)] !pl-14 !text-lg shadow-[var(--n-sombra)]"
          placeholder="Buscar por nome, telefone ou CPF"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          aria-label={`Buscar ${rotulo.toLowerCase()}`}
          autoFocus
        />
        <span
          className="n-fraco pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-xl"
          aria-hidden
        >
          ⌕
        </span>
      </div>
      <div className="mt-6">
        {lista.isLoading ? (
          <Carregando linhas={5} />
        ) : (lista.data ?? []).length === 0 ? (
          <Vazio
            titulo="Ninguém encontrado"
            texto="Confira o nome ou busque pelo telefone com DDD."
          />
        ) : (
          <ul className="n-cartao grid gap-0.5 p-2">
            {(lista.data ?? []).map((c) => {
              const nome = rotuloDoContato(c, t);
              return (
                <li key={c.id}>
                  <Link
                    href={`/pacientes/${c.id}`}
                    className="n-linha-clicavel items-center gap-4 px-3 py-3"
                  >
                    <Avatar nome={nome} tamanho={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{nome}</span>
                      <span className="n-suave block truncate text-sm">
                        {c.phone_number ?? t("Sem telefone")}
                      </span>
                    </span>
                    <span className="n-fraco">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <FolhaDoPaciente
        aberta={cadastrar}
        aoFechar={() => setCadastrar(false)}
        aoCriar={(id) => router.push(`/pacientes/${id}`)}
      />
    </div>
  );
}
