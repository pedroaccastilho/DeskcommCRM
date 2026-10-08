"use client";

/**
 * HOJE / MEU DIA — a primeira tela da interface nova.
 *
 * Em cima, a saudação e a LINHA DO DIA: o expediente inteiro numa faixa só, com cada sessão
 * pintada na cor da modalidade e o "agora" andando. Logo abaixo, o cartão escuro do PRÓXIMO
 * paciente, com o único botão que importa naquele momento. Depois, o dia em listas curtas, na
 * ordem em que pedem atenção: na clínica (chegou ou em atendimento, o "Na clínica" do Balcão),
 * passou do horário, em andamento, falta registrar, sem confirmação, confirmados.
 *
 * Recepção e gestão veem a clínica (gestão pode filtrar por profissional); quem atende vê só as
 * próprias sessões e, ao lado, as evoluções que faltam escrever.
 */
import Link from "next/link";
import * as React from "react";

import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { diaLocalISO } from "@/lib/agenda/fuso";
import { POLITICA_PADRAO, type SessaoDaGrade } from "@/lib/clinica/agenda";
import { formatCents, moedaServidaOu } from "@/lib/money";
import {
  arrumarDia,
  janelaDoDia,
  momentoDa,
  posicaoNaJanela,
  proximoAberto,
  quantoFalta,
  saudacao,
  soAsMinhas,
} from "@/lib/novo/hoje";

import { useNovo } from "@/components/novo/Casca";
import {
  useGradeDoDia,
  useAConfirmar,
  useMultasPendentes,
  usePacotesParaRenovar,
  usePendencias,
  useTiposDeAtendimento,
} from "@/components/novo/dados";
import { PainelDeTarefas } from "@/components/novo/Tarefas";
import { FolhaAgendar } from "@/components/novo/FolhaAgendar";
import { FolhaDaSessao, seloDa } from "@/components/novo/FolhaDaSessao";
import { FolhaDeEvolucao } from "@/components/novo/FolhaDeEvolucao";
import { LinhaDaSessao } from "@/components/novo/LinhaDaSessao";
import {
  Avatar,
  Carregando,
  PontoDaModalidade,
  Secao,
  Vazio,
  dataLonga,
  hora,
  horaDecimal,
  primeiroNome,
  useAgora,
} from "@/components/novo/pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

export function Hoje() {
  const t = useT();
  const tag = useTagDeIdioma();
  const { fuso, cargo, meuId, meuNome, soAsMinhas: soMinhas, role, veProntuario } = useNovo();
  const org = useActiveOrg();
  const agora = useAgora();
  const dia = diaLocalISO(agora, fuso);
  const grade = useGradeDoDia(dia, fuso);
  const tipos = useTiposDeAtendimento();
  const recepcao = !soMinhas && role !== "viewer";
  const renovar = usePacotesParaRenovar(recepcao);
  const multas = useMultasPendentes(recepcao);
  const aConfirmar = useAConfirmar(recepcao);
  const pendencias = usePendencias(veProntuario);
  const conversas = useConversationCounts(recepcao ? (org?.orgId ?? null) : null);

  const [filtroProf, setFiltroProf] = React.useState<string | null>(null);
  const [aberta, setAberta] = React.useState<string | null>(null);
  const [agendar, setAgendar] = React.useState(false);
  const [escrever, setEscrever] = React.useState<{
    contactId: string;
    nome: string;
    appointmentId: string;
  } | null>(null);

  const profissionais = grade.data?.profissionais ?? [];
  const nomeDe = (id: string | null) =>
    (id && profissionais.find((p) => p.user_id === id)?.nome) || null;
  const todas = grade.data?.sessoes ?? [];
  const visiveis = soMinhas
    ? soAsMinhas(todas, meuId)
    : filtroProf
      ? todas.filter((s) => s.profissional_user_id === filtroProf)
      : todas;
  const arrumado = arrumarDia(visiveis, agora);
  // As de hoje já estão na lista do dia; o painel "A confirmar" fica com as dos próximos dias.
  const proximasAConfirmar = (aConfirmar.data ?? []).filter(
    (s) => diaLocalISO(new Date(s.inicio), fuso) !== dia,
  );
  const sessaoAberta =
    todas.find((s) => s.id === aberta) ?? proximasAConfirmar.find((s) => s.id === aberta) ?? null;
  const politica = grade.data?.politica ?? POLITICA_PADRAO;
  const precoDe = (s: SessaoDaGrade | null) =>
    (s?.tipo && tipos.data?.find((t) => t.event_type_id === s.tipo!.id)?.preco_cents) ?? null;

  const abrir = (s: SessaoDaGrade) => setAberta(s.id);
  const linhas = (lista: SessaoDaGrade[]) => (
    <div className="n-cartao grid gap-0.5 p-2">
      {lista.map((s) => (
        <LinhaDaSessao
          key={s.id}
          sessao={s}
          agora={agora}
          nomeDoProfissional={nomeDe(s.profissional_user_id)}
          aoAbrir={() => abrir(s)}
        />
      ))}
    </div>
  );

  const [verEncerradas, setVerEncerradas] = React.useState(false);
  const moeda = moedaServidaOu(org?.currency);
  const lateral = recepcao || veProntuario;

  return (
    <div className="n-conteudo" data-testid="novo-hoje">
      {/* Saudação */}
      <header className="n-entra flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="n-suave n-inicial text-sm font-semibold">
            {dataLonga(agora.toISOString(), fuso, tag)}
          </p>
          <h1 className="n-titulo mt-1 text-[40px] leading-[1.05] sm:text-[52px]">
            {saudacao(Number(hora(agora.toISOString(), fuso).slice(0, 2)))},{" "}
            <em className="text-[var(--n-acao)] not-italic">{primeiroNome(meuNome)}</em>.
          </h1>
          <p className="n-suave mt-2 text-[15px]">
            {grade.isLoading
              ? t("Carregando o dia…")
              : arrumado.total === 0
                ? soMinhas
                  ? t("Você não tem sessões hoje.")
                  : t("Nenhuma sessão marcada para hoje.")
                : `${arrumado.total} ${arrumado.total === 1 ? t("sessão") : t("sessões")} ${soMinhas ? t("na sua agenda") : t("na clínica")} ${t("hoje")}, ${arrumado.realizadas} ${arrumado.realizadas === 1 ? t("realizada") : t("realizadas")}.`}
          </p>
        </div>
        {role !== "viewer" && (
          <button
            type="button"
            className="n-botao n-botao-principal"
            onClick={() => setAgendar(true)}
          >
            + Agendar
          </button>
        )}
      </header>

      {/* Filtro por profissional (só gestão) */}
      {cargo === "gestao" && profissionais.length > 1 && (
        <div
          className="n-entra mt-6 flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="Profissional"
        >
          <button
            type="button"
            className="n-chip"
            aria-pressed={filtroProf === null}
            onClick={() => setFiltroProf(null)}
          >
            {t("Toda a clínica")}
          </button>
          {profissionais.map((p) => (
            <button
              key={p.user_id}
              type="button"
              className="n-chip"
              aria-pressed={filtroProf === p.user_id}
              onClick={() => setFiltroProf(p.user_id)}
            >
              <Avatar nome={p.nome} tamanho={20} />
              {p.nome}
            </button>
          ))}
        </div>
      )}

      {/* Linha do dia */}
      <LinhaDoDia sessoes={visiveis} agora={agora} fuso={fuso} aoAbrir={abrir} />

      <div
        className={`mt-8 grid grid-cols-[minmax(0,1fr)] gap-8 ${lateral ? "lg:grid-cols-[minmax(0,1fr)_340px]" : ""}`}
      >
        <div className="grid content-start gap-8">
          {grade.isLoading ? (
            <Carregando />
          ) : (
            <>
              {arrumado.proxima && (
                <Proxima
                  sessao={arrumado.proxima}
                  agora={agora}
                  nomeDoProfissional={nomeDe(arrumado.proxima.profissional_user_id)}
                  aoAbrir={() => abrir(arrumado.proxima!)}
                />
              )}
              {arrumado.naClinica.length > 0 && (
                <Secao titulo="Na clínica" contagem={arrumado.naClinica.length}>
                  {linhas(arrumado.naClinica)}
                </Secao>
              )}
              {arrumado.atrasadas.length > 0 && (
                <Secao titulo="Passou do horário" contagem={arrumado.atrasadas.length} tom="aviso">
                  {linhas(arrumado.atrasadas)}
                </Secao>
              )}
              {arrumado.agora.length > 0 && (
                <Secao titulo="Acontecendo agora" contagem={arrumado.agora.length}>
                  {linhas(arrumado.agora)}
                </Secao>
              )}
              {arrumado.paraFechar.length > 0 && (
                <Secao
                  titulo="Já passou: falta registrar"
                  contagem={arrumado.paraFechar.length}
                  tom="alerta"
                >
                  {linhas(arrumado.paraFechar)}
                </Secao>
              )}
              {arrumado.semConfirmacao.length > 0 && (
                <Secao
                  titulo="Ainda sem confirmação"
                  contagem={arrumado.semConfirmacao.length}
                  tom="aviso"
                >
                  {linhas(arrumado.semConfirmacao)}
                </Secao>
              )}
              {arrumado.confirmadas.length > 0 && (
                <Secao titulo="Confirmados" contagem={arrumado.confirmadas.length}>
                  {linhas(arrumado.confirmadas)}
                </Secao>
              )}
              {arrumado.total === 0 && arrumado.encerradas.length === 0 && (
                <Vazio
                  titulo="Dia livre"
                  texto={
                    soMinhas
                      ? "Quando a recepção marcar um horário com você, ele aparece aqui."
                      : "Use “Agendar” para marcar o primeiro horário do dia."
                  }
                />
              )}
              {arrumado.encerradas.length > 0 && (
                <Secao
                  titulo="Encerrados"
                  contagem={arrumado.encerradas.length}
                  acao={
                    <button
                      type="button"
                      className="n-chip"
                      onClick={() => setVerEncerradas((v) => !v)}
                    >
                      {verEncerradas ? "Esconder" : "Mostrar"}
                    </button>
                  }
                >
                  {verEncerradas ? linhas(arrumado.encerradas) : null}
                </Secao>
              )}
            </>
          )}
        </div>

        {lateral && (
          <aside className="grid content-start gap-5">
            {veProntuario && (
              <PainelLateral
                titulo="Evoluções para escrever"
                vazio="Nenhuma evolução pendente. Tudo em dia."
                itens={(pendencias.data ?? []).slice(0, 6).map((p) => ({
                  id: p.appointment_id,
                  nome: p.paciente,
                  detalhe: `${dataLonga(p.inicio, fuso, tag).split(",")[0]} às ${hora(p.inicio, fuso)}`,
                  alerta: p.atrasada,
                  acao: () =>
                    setEscrever({
                      contactId: p.contact_id,
                      nome: p.paciente,
                      appointmentId: p.appointment_id,
                    }),
                  rotuloDaAcao: "Escrever",
                }))}
                total={pendencias.data?.length ?? 0}
                testid="novo-pendencias"
              />
            )}
            <PainelDeTarefas />
            {recepcao && (
              <>
                <Link
                  href="/whatsapp"
                  className="n-cartao n-entra flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--n-ok-suave)] text-[var(--n-ok)]">
                    <span className="n-titulo n-numero text-2xl">
                      {conversas.data?.fila ?? conversas.data?.unassigned ?? 0}
                    </span>
                  </span>
                  <span className="flex-1">
                    <span className="block font-bold">Conversas esperando</span>
                    <span className="n-suave text-sm">{t("No WhatsApp da clínica")}</span>
                  </span>
                  <span className="n-fraco">›</span>
                </Link>
                <PainelLateral
                  titulo="A confirmar nos próximos dias"
                  vazio="Todo mundo de amanhã já confirmou."
                  itens={proximasAConfirmar.slice(0, 6).map((s) => {
                    const nome = s.paciente?.nome ?? s.titulo;
                    return {
                      id: s.id,
                      nome,
                      detalhe: `${dataLonga(s.inicio, fuso, tag).split(",")[0]} ${t("às")} ${hora(s.inicio, fuso)} · ${s.tipo?.nome ?? s.titulo}`,
                      acao: () => abrir(s),
                      rotuloDaAcao: "Abrir",
                    };
                  })}
                  total={proximasAConfirmar.length}
                  testid="novo-a-confirmar"
                />
                <PainelLateral
                  titulo="Oferecer renovação"
                  vazio="Ninguém com o pacote no fim."
                  itens={(renovar.data ?? []).slice(0, 5).map((p) => {
                    const nome = rotuloDoContato(p.paciente, t);
                    return {
                      id: p.id,
                      nome,
                      detalhe: `${p.saldo} ${p.saldo === 1 ? "sessão restante" : "sessões restantes"} · ${p.nome}`,
                      href: `/pacientes/${p.contact_id}`,
                    };
                  })}
                  total={renovar.data?.length ?? 0}
                />
                {(multas.data?.length ?? 0) > 0 && (
                  <PainelLateral
                    titulo="Multas em aberto"
                    vazio=""
                    itens={(multas.data ?? []).slice(0, 5).map((m) => {
                      const nome = rotuloDoContato(m.contacts, t);
                      return {
                        id: m.id,
                        nome,
                        detalhe:
                          m.valor_cents != null
                            ? formatCents(m.valor_cents, moeda)
                            : `${m.percentual}% da sessão`,
                        href: `/pacientes/${m.contact_id}`,
                      };
                    })}
                    total={multas.data?.length ?? 0}
                  />
                )}
              </>
            )}
          </aside>
        )}
      </div>

      <FolhaDaSessao
        key={sessaoAberta?.id ?? "nenhuma"}
        sessao={sessaoAberta}
        politica={politica}
        precoCents={precoDe(sessaoAberta)}
        nomeDoProfissional={sessaoAberta ? nomeDe(sessaoAberta.profissional_user_id) : null}
        aoFechar={() => setAberta(null)}
        proximo={sessaoAberta ? proximoAberto(visiveis, sessaoAberta.id, agora) : null}
        aoChamarProximo={setAberta}
      />
      <FolhaAgendar
        aberta={agendar}
        aoFechar={() => setAgendar(false)}
        profissionais={profissionais}
      />
      {escrever && (
        <FolhaDeEvolucao
          contactId={escrever.contactId}
          nomeDoPaciente={escrever.nome}
          appointmentId={escrever.appointmentId}
          modalidadeSugerida={null}
          aoFechar={() => setEscrever(null)}
        />
      )}
    </div>
  );
}

function Proxima({
  sessao,
  agora,
  nomeDoProfissional,
  aoAbrir,
}: {
  sessao: SessaoDaGrade;
  agora: Date;
  nomeDoProfissional: string | null;
  aoAbrir: () => void;
}) {
  const t = useT();
  const { fuso, soAsMinhas } = useNovo();
  const nome = sessao.paciente?.nome ?? sessao.titulo;
  const selo = seloDa(sessao, agora);
  return (
    <button
      type="button"
      onClick={aoAbrir}
      className="n-entra group relative overflow-hidden rounded-[28px] bg-[var(--n-destaque)] p-6 text-left text-[var(--n-destaque-tinta)] shadow-[var(--n-sombra-alta)] sm:p-8"
      data-testid="novo-proxima"
    >
      <span
        className="pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full opacity-40 blur-3xl"
        style={{ background: `var(--agenda-modalidade-${sessao.modalidade ?? "outra"})` }}
        aria-hidden
      />
      <span className="relative flex flex-wrap items-center gap-2 text-sm font-semibold opacity-80">
        {t("Próximo")} · {quantoFalta(new Date(sessao.inicio), agora)}
        <span className={`n-selo ${selo.classe} !bg-white/10 !text-white`}>{selo.rotulo}</span>
      </span>
      <span className="relative mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:gap-5">
        <span className="n-titulo n-numero text-[64px] leading-[0.9] sm:text-[80px]">
          {hora(sessao.inicio, fuso)}
        </span>
        <span className="min-w-0 flex-1 pb-1">
          <span className="n-titulo block truncate text-[26px] leading-tight sm:text-[32px]">
            {nome}
          </span>
          <span className="flex min-w-0 items-center gap-2 text-sm opacity-80">
            <PontoDaModalidade modalidade={sessao.modalidade} />
            <span className="truncate">
              {sessao.tipo?.nome ?? sessao.titulo}
              {!soAsMinhas && nomeDoProfissional ? ` · com ${nomeDoProfissional}` : ""}
            </span>
          </span>
        </span>
      </span>
      <span className="relative mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--n-destaque-tinta)] px-5 py-2.5 text-sm font-bold text-[var(--n-destaque)] transition-transform group-hover:translate-x-1">
        {momentoDa(sessao, agora) === "sem_confirmacao"
          ? t("Confirmar ou lembrar")
          : t("Ver detalhes")}{" "}
        →
      </span>
    </button>
  );
}

function LinhaDoDia({
  sessoes,
  agora,
  fuso,
  aoAbrir,
}: {
  sessoes: SessaoDaGrade[];
  agora: Date;
  fuso: string;
  aoAbrir: (s: SessaoDaGrade) => void;
}) {
  const horas = sessoes
    .filter((s) => s.status !== "cancelled")
    .map((s) => ({ s, inicio: horaDecimal(s.inicio, fuso), fim: horaDecimal(s.fim, fuso) || 24 }));
  const janela = janelaDoDia(horas);
  const agoraH = horaDecimal(agora.toISOString(), fuso);
  const marcas: number[] = [];
  for (let h = janela.de; h <= janela.ate; h += h < janela.ate - 1 ? 2 : 1) marcas.push(h);
  return (
    <div className="n-cartao n-entra mt-6 px-5 pt-4 pb-3 sm:px-7" data-testid="novo-linha-do-dia">
      <div className="n-linha-do-dia">
        <div className="n-trilha" />
        <div className="n-passado" style={{ width: `${posicaoNaJanela(agoraH, janela) * 100}%` }} />
        {horas.map(({ s, inicio, fim }) => (
          <button
            key={s.id}
            type="button"
            className="n-bloco"
            title={`${hora(s.inicio, fuso)} ${s.paciente?.nome ?? s.titulo}`}
            aria-label={`${hora(s.inicio, fuso)} ${s.paciente?.nome ?? s.titulo}`}
            onClick={() => aoAbrir(s)}
            style={{
              left: `${posicaoNaJanela(inicio, janela) * 100}%`,
              width: `${Math.max(1.2, (posicaoNaJanela(fim, janela) - posicaoNaJanela(inicio, janela)) * 100)}%`,
              background: `var(--agenda-modalidade-${s.modalidade ?? "outra"})`,
              opacity: s.status === "completed" || s.status === "no_show" ? 0.45 : 1,
            }}
          />
        ))}
        {agoraH >= janela.de && agoraH <= janela.ate && (
          <div className="n-agora" style={{ left: `${posicaoNaJanela(agoraH, janela) * 100}%` }} />
        )}
      </div>
      <div className="relative h-4">
        {marcas.map((h) => (
          <span
            key={h}
            className="n-fraco n-numero absolute -translate-x-1/2 text-[11px] font-semibold"
            style={{ left: `${posicaoNaJanela(h, janela) * 100}%` }}
          >
            {h}h
          </span>
        ))}
      </div>
    </div>
  );
}

interface ItemLateral {
  id: string;
  nome: string;
  detalhe: string;
  alerta?: boolean;
  href?: string;
  acao?: () => void;
  rotuloDaAcao?: string;
}

function PainelLateral({
  titulo,
  itens,
  total,
  vazio,
  testid,
}: {
  titulo: string;
  itens: ItemLateral[];
  total: number;
  vazio: string;
  testid?: string;
}) {
  return (
    <section className="n-cartao n-entra p-5" data-testid={testid}>
      <h2 className="mb-3 flex items-center justify-between text-[15px] font-bold">
        {titulo}
        <span className="n-fraco n-numero">{total}</span>
      </h2>
      {itens.length === 0 ? (
        <p className="n-suave text-sm">{vazio}</p>
      ) : (
        <ul className="grid gap-1">
          {itens.map((i) => {
            const corpo = (
              <>
                <Avatar nome={i.nome} tamanho={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{i.nome}</span>
                  <span
                    className={`block truncate text-xs ${i.alerta ? "text-[var(--n-alerta)]" : "n-suave"}`}
                  >
                    {i.detalhe}
                  </span>
                </span>
              </>
            );
            return (
              <li key={i.id}>
                {i.href ? (
                  <Link href={i.href} className="n-linha-clicavel items-center gap-3 px-2 py-2">
                    {corpo}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-2 py-2">
                    {corpo}
                    {i.acao && (
                      <button
                        type="button"
                        className="n-botao n-botao-suave n-botao-pequeno"
                        onClick={i.acao}
                      >
                        {i.rotuloDaAcao}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
