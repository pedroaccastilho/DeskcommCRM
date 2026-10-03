"use client";

/**
 * A FICHA do paciente na interface nova: quem é, o que vem por aí, o pacote (com a barrinha de
 * sessões) e, para quem é profissional de saúde, o prontuário inteiro em linha do tempo — todo
 * profissional lê o histórico completo, de todas as áreas (decisão do Pedro, 2026-10-03), e
 * assina só o que é dele.
 */
import Link from "next/link";
import * as React from "react";

import { ApiError } from "@/lib/api/types";
import {
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  camposParaMostrar,
  valorParaMostrar,
} from "@/lib/clinica/vocabulario";

import { useNovo } from "@/components/novo/Casca";
import {
  useGradeDoDia,
  usePaciente,
  usePacotesDoPaciente,
  useProntuario,
  useSessoesDoPaciente,
  type RegistroDoProntuario,
} from "@/components/novo/dados";
import { FolhaAgendar } from "@/components/novo/FolhaAgendar";
import { FolhaDeEvolucao } from "@/components/novo/FolhaDeEvolucao";
import {
  Avatar,
  Carregando,
  PontoDaModalidade,
  Secao,
  Vazio,
  dataCurta,
  hora,
} from "@/components/novo/pecas";
import { diaLocalISO } from "@/lib/agenda/fuso";

const SITUACAO: Record<string, { rotulo: string; classe: string }> = {
  pending: { rotulo: "A confirmar", classe: "n-selo-aviso" },
  confirmed: { rotulo: "Confirmado", classe: "n-selo-ok" },
  completed: { rotulo: "Realizado", classe: "n-selo-neutro" },
  no_show: { rotulo: "Faltou", classe: "n-selo-alerta" },
  cancelled: { rotulo: "Cancelado", classe: "n-selo-neutro" },
};

export function Paciente({ contactId }: { contactId: string }) {
  const { fuso, eu, role } = useNovo();
  const paciente = usePaciente(contactId);
  const sessoes = useSessoesDoPaciente(contactId);
  const pacotes = usePacotesDoPaciente(contactId);
  const ehProfissional = Boolean(eu?.profissional);
  const prontuario = useProntuario(contactId, ehProfissional);
  // A grade de hoje só serve para saber quem são os profissionais na hora de agendar.
  const grade = useGradeDoDia(diaLocalISO(new Date(), fuso), fuso);
  const [agendar, setAgendar] = React.useState(false);
  const [escrever, setEscrever] = React.useState(false);

  if (paciente.isLoading) {
    return (
      <div className="n-conteudo">
        <Carregando />
      </div>
    );
  }
  if (!paciente.data) {
    return (
      <div className="n-conteudo">
        <Vazio
          titulo="Paciente não encontrado"
          texto="Ele pode ter sido apagado ou unido a outro cadastro."
        />
      </div>
    );
  }

  const c = paciente.data;
  const nome = c.display_name || c.name || c.phone_number || "Sem nome";
  const nascimento = c.birthdate ? idade(c.birthdate) : null;
  const vigentes = (pacotes.data ?? []).filter((p) => p.situacao === "ativo");
  const futuras = sessoes.data?.futuras ?? [];
  const passadas = sessoes.data?.passadas ?? [];
  const realizadas = passadas.filter((s) => s.situacao === "completed").length;
  const faltas = passadas.filter((s) => s.situacao === "no_show").length;

  return (
    <div className="n-conteudo" data-testid="novo-paciente">
      <Link href="/novo/pacientes" className="n-suave text-sm font-semibold">
        ‹ Pacientes
      </Link>

      <header className="n-entra mt-4 flex flex-wrap items-center gap-5">
        <Avatar nome={nome} tamanho={84} />
        <div className="min-w-0 flex-1">
          <h1 className="n-titulo text-[38px] leading-tight sm:text-[48px]">{nome}</h1>
          <p className="n-suave mt-1 flex flex-wrap gap-x-4 text-[15px]">
            {c.phone_number && <span>{c.phone_number}</span>}
            {nascimento !== null && <span>{nascimento} anos</span>}
            {c.email && <span>{c.email}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {ehProfissional && (
            <button
              type="button"
              className="n-botao n-botao-escuro"
              onClick={() => setEscrever(true)}
            >
              Escrever evolução
            </button>
          )}
          {role !== "viewer" && (
            <button
              type="button"
              className="n-botao n-botao-principal"
              onClick={() => setAgendar(true)}
            >
              + Agendar
            </button>
          )}
        </div>
      </header>

      {/* Números do paciente */}
      <div className="n-entra mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero
          rotulo="Próxima sessão"
          valor={futuras[0] ? dataCurta(futuras[0].iniciaEm, fuso) : "—"}
          detalhe={futuras[0] ? hora(futuras[0].iniciaEm, fuso) : "nada marcado"}
        />
        <Numero rotulo="Realizadas" valor={String(realizadas)} detalhe="nos últimos 60 dias" />
        <Numero
          rotulo="Faltas"
          valor={String(faltas)}
          detalhe="nos últimos 60 dias"
          alerta={faltas >= 2}
        />
        <Numero
          rotulo="Pacote"
          valor={vigentes[0] ? `${vigentes[0].saldo}` : "—"}
          detalhe={
            vigentes[0]
              ? `${vigentes[0].saldo === 1 ? "sessão restante" : "sessões restantes"}`
              : "sem pacote ativo"
          }
          alerta={vigentes[0]?.precisa_renovar}
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-8">
          {ehProfissional ? (
            <Secao titulo="Prontuário" contagem={prontuario.data?.length}>
              {prontuario.isLoading ? (
                <Carregando linhas={2} />
              ) : (prontuario.data ?? []).length === 0 ? (
                <Vazio
                  titulo="Prontuário em branco"
                  texto="A primeira avaliação ou evolução aparece aqui."
                />
              ) : (
                <ol
                  className="relative grid gap-4 border-l-2 border-[var(--n-linha)] pl-6"
                  data-testid="novo-prontuario"
                >
                  {(prontuario.data ?? []).map((r) => (
                    <Registro key={r.id} registro={r} fuso={fuso} />
                  ))}
                </ol>
              )}
            </Secao>
          ) : (
            <div className="n-cartao n-suave p-5 text-sm">
              O prontuário é visto só pelos profissionais de saúde da clínica.
            </div>
          )}

          <Secao titulo="Histórico recente" contagem={passadas.length}>
            {passadas.length === 0 ? (
              <p className="n-suave px-1 text-sm">Nenhuma sessão nos últimos 60 dias.</p>
            ) : (
              <ul className="n-cartao grid gap-0.5 p-2">
                {passadas.slice(0, 12).map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="n-numero w-28 text-sm font-semibold capitalize">
                      {dataCurta(s.iniciaEm, fuso)}
                    </span>
                    <span className="n-suave flex-1 truncate text-sm">
                      {s.tipo?.nome ?? s.titulo}
                    </span>
                    <span className={`n-selo ${SITUACAO[s.situacao]?.classe ?? "n-selo-neutro"}`}>
                      {SITUACAO[s.situacao]?.rotulo ?? s.situacao}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>

        <aside className="grid content-start gap-5">
          <section className="n-cartao p-5">
            <h2 className="mb-3 text-[15px] font-bold">Próximas sessões</h2>
            {futuras.length === 0 ? (
              <p className="n-suave text-sm">Nada marcado.</p>
            ) : (
              <ul className="grid gap-3">
                {futuras.slice(0, 6).map((s) => (
                  <li key={s.id} className="flex items-center gap-3">
                    <span className="grid w-12 flex-none place-items-center rounded-xl bg-[var(--n-papel)] py-1.5">
                      <span className="n-titulo n-numero text-lg leading-none">
                        {new Intl.DateTimeFormat("pt-BR", {
                          day: "numeric",
                          timeZone: fuso,
                        }).format(new Date(s.iniciaEm))}
                      </span>
                      <span className="n-fraco text-[10px] font-bold uppercase">
                        {new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: fuso })
                          .format(new Date(s.iniciaEm))
                          .replace(".", "")}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {s.tipo?.nome ?? s.titulo}
                      </span>
                      <span className="n-suave text-xs capitalize">
                        {new Intl.DateTimeFormat("pt-BR", {
                          weekday: "long",
                          timeZone: fuso,
                        }).format(new Date(s.iniciaEm))}{" "}
                        às {hora(s.iniciaEm, fuso)}
                      </span>
                    </span>
                    <span className={`n-selo ${SITUACAO[s.situacao]?.classe ?? "n-selo-neutro"}`}>
                      {SITUACAO[s.situacao]?.rotulo ?? s.situacao}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!(pacotes.error instanceof ApiError && pacotes.error.status === 403) && (
            <section className="n-cartao p-5" data-testid="novo-pacotes">
              <h2 className="mb-3 text-[15px] font-bold">Pacotes</h2>
              {vigentes.length === 0 ? (
                <p className="n-suave text-sm">
                  Nenhum pacote valendo. A venda fica na ficha da versão atual.
                </p>
              ) : (
                <ul className="grid gap-4">
                  {vigentes.map((p) => (
                    <li key={p.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-bold">
                          <PontoDaModalidade modalidade={p.modalidade} />
                          {p.nome}
                        </span>
                        <span className="n-numero text-sm font-semibold">
                          {p.sessoes_usadas}/{p.sessoes_total}
                        </span>
                      </div>
                      <div
                        className="mt-2 flex gap-1"
                        aria-label={`${p.sessoes_usadas} de ${p.sessoes_total} sessões usadas`}
                      >
                        {Array.from({ length: p.sessoes_total }, (_, i) => (
                          <span
                            key={i}
                            className="h-2.5 flex-1 rounded-full"
                            style={{
                              background:
                                i < p.sessoes_usadas
                                  ? `var(--agenda-modalidade-${p.modalidade})`
                                  : "var(--n-papel-2)",
                            }}
                          />
                        ))}
                      </div>
                      <p
                        className={`mt-1.5 text-xs ${p.precisa_renovar ? "font-bold text-[var(--n-aviso)]" : "n-suave"}`}
                      >
                        {p.precisa_renovar ? "Hora de oferecer a renovação · " : ""}vale até{" "}
                        {new Intl.DateTimeFormat("pt-BR", {
                          day: "numeric",
                          month: "long",
                          timeZone: "UTC",
                        }).format(new Date(p.valido_ate))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <a
            href={`/app/contacts/${contactId}`}
            className="n-fraco px-1 text-sm font-semibold hover:underline"
          >
            Abrir a ficha completa na versão atual ›
          </a>
        </aside>
      </div>

      <FolhaAgendar
        aberta={agendar}
        aoFechar={() => setAgendar(false)}
        profissionais={grade.data?.profissionais ?? []}
        pacienteInicial={{ id: contactId, nome }}
      />
      {escrever && (
        <FolhaDeEvolucao
          contactId={contactId}
          nomeDoPaciente={nome}
          appointmentId={null}
          modalidadeSugerida={null}
          aoFechar={() => setEscrever(false)}
        />
      )}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  detalhe,
  alerta,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
  alerta?: boolean;
}) {
  return (
    <div className="n-cartao p-4">
      <p className="n-suave text-xs font-bold">{rotulo}</p>
      <p
        className={`n-titulo n-numero mt-1 truncate text-[28px] leading-tight capitalize ${alerta ? "text-[var(--n-alerta)]" : ""}`}
      >
        {valor}
      </p>
      <p className="n-fraco truncate text-xs">{detalhe}</p>
    </div>
  );
}

function Registro({ registro: r, fuso }: { registro: RegistroDoProntuario; fuso: string }) {
  const campos = camposParaMostrar(r.modalidade, r.tipo).filter(
    (c) => r.conteudo[c.chave] !== undefined && String(r.conteudo[c.chave]).trim() !== "",
  );
  return (
    <li className="relative">
      <span
        className="absolute top-5 -left-[33px] h-4 w-4 rounded-full border-[3px] border-[var(--n-papel)]"
        style={{ background: `var(--agenda-modalidade-${r.modalidade})` }}
        aria-hidden
      />
      <article className="n-cartao p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">
            {ROTULO_DO_TIPO[r.tipo]}{" "}
            <span className="n-suave font-semibold">· {ROTULO_DA_MODALIDADE[r.modalidade]}</span>
          </h3>
          <span className="n-fraco text-xs font-semibold capitalize">
            {dataCurta(r.assinado_em, fuso)} · {hora(r.assinado_em, fuso)}
          </span>
        </header>
        {campos.length > 0 && (
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {campos.map((c) => (
              <div key={c.chave} className={c.tipo === "texto_longo" ? "sm:col-span-2" : ""}>
                <dt className="n-fraco text-xs font-bold">{c.rotulo}</dt>
                <dd className="text-[14.5px] whitespace-pre-wrap">
                  {valorParaMostrar(c, r.conteudo[c.chave]!)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {r.texto && <p className="mt-3 text-[14.5px] whitespace-pre-wrap">{r.texto}</p>}
        <footer className="n-suave mt-3 text-xs">
          Assinado por {r.autor_nome}
          {r.autor_registro ? ` · ${r.autor_registro}` : ""}
        </footer>
      </article>
    </li>
  );
}

function idade(nascimento: string): number | null {
  const d = new Date(nascimento);
  if (Number.isNaN(d.getTime())) return null;
  const hoje = new Date();
  let anos = hoje.getFullYear() - d.getFullYear();
  if (
    hoje.getMonth() < d.getMonth() ||
    (hoje.getMonth() === d.getMonth() && hoje.getDate() < d.getDate())
  )
    anos -= 1;
  return anos;
}
