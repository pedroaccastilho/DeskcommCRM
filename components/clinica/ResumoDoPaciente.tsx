"use client";

/**
 * O resumo no topo da ficha do paciente — o lado de TELA de
 * `lib/clinica/resumo-do-paciente.ts`.
 *
 * Mostra as modalidades e a equipe do paciente e três cartões: a próxima
 * sessão, a reavaliação e como foram os últimos 60 dias. Só aparece com o
 * módulo clínica instalado e quando o contato tem alguma sessão na agenda; um
 * contato de vendas continua com a ficha de sempre.
 */
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import Link from "next/link";
import * as React from "react";

import { AvatarDaPessoa } from "@/components/agenda/AvatarDaPessoa";
import { usePessoasDaAgenda } from "@/hooks/agenda/usePessoasDaAgenda";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { dataDeParede } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import { corDaModalidade } from "@/lib/clinica/cores-da-agenda";
import { resumoDoPaciente, type SessaoDoPaciente } from "@/lib/clinica/resumo-do-paciente";
import { ROTULO_DA_MODALIDADE } from "@/lib/clinica/vocabulario";
import { cn } from "@/lib/utils";

/** A janela do passado que o resumo conta. A rota aceita até 62 dias por consulta. */
const DIAS_PASSADOS = 60;

type Listado = {
  id: string;
  titulo: string;
  iniciaEm: string;
  fuso: string;
  situacao: string;
  donoId: string | null;
  tipo: { nome: string } | null;
};

type SessaoComFuso = SessaoDoPaciente & { fuso: string };

async function listar(qs: URLSearchParams): Promise<SessaoComFuso[]> {
  const r = await apiClient.get<{ data: Listado[] }>(
    `/api/v1/agenda/agendamentos?${qs.toString()}`,
  );
  return (r.data ?? []).map((a) => ({
    id: a.id,
    titulo: a.titulo,
    tipo: a.tipo?.nome || null,
    inicio: a.iniciaEm,
    situacao: a.situacao,
    donoId: a.donoId,
    fuso: a.fuso,
  }));
}

/**
 * Duas perguntas à mesma rota: o que vem (sem janela, ela devolve de agora em
 * diante) e os últimos 60 dias. A chave começa por "agenda" para marcar e
 * remarcar pela tela atualizarem o resumo junto com a grade.
 */
function useSessoesDoPaciente(contactId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ["agenda", "paciente", contactId],
    enabled: habilitado,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const agora = new Date();
      const de = new Date(agora.getTime() - DIAS_PASSADOS * 86_400_000);
      const [futuras, passadas] = await Promise.all([
        listar(new URLSearchParams({ contact_id: contactId, limite: "50" })),
        listar(
          new URLSearchParams({
            contact_id: contactId,
            de: de.toISOString(),
            ate: agora.toISOString(),
            limite: "200",
          }),
        ),
      ]);
      const vistas = new Set<string>();
      return [...passadas, ...futuras].filter((s) => !vistas.has(s.id) && vistas.add(s.id));
    },
  });
}

function juntarNomes(nomes: string[], t: (s: string) => string): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} ${t("e")} ${nomes[nomes.length - 1]}`;
}

function Cartao({
  testid,
  rotulo,
  valor,
  detalhe,
  vazio = false,
}: {
  testid: string;
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  vazio?: boolean;
}) {
  return (
    <div
      data-testid={testid}
      className="grid content-start gap-1 rounded-lg border border-border bg-surface p-4"
    >
      <span className="text-sm text-text-muted">{rotulo}</span>
      <span
        className={cn(
          "first-letter:uppercase",
          vazio ? "text-base text-text-muted" : "text-lg font-semibold text-text",
        )}
      >
        {valor}
      </span>
      {detalhe && <span className="text-sm text-text-muted">{detalhe}</span>}
    </div>
  );
}

export function ResumoDoPaciente({ contactId, ativo }: { contactId: string; ativo: boolean }) {
  const t = useT();
  const localeDaData = useLocaleDeData();
  const sessoes = useSessoesDoPaciente(contactId, ativo);
  const { data: pessoas = [] } = usePessoasDaAgenda();
  // O "agora" do resumo é o da última leitura, não um relógio a cada render.
  const agora = React.useMemo(() => new Date(sessoes.dataUpdatedAt || 0), [sessoes.dataUpdatedAt]);

  if (!ativo || !sessoes.data || sessoes.data.length === 0) return null;

  const resumo = resumoDoPaciente(sessoes.data, agora);
  const fusoDe = (id: string) => sessoes.data.find((s) => s.id === id)?.fuso ?? "UTC";
  const nomeDe = (id: string | null) => pessoas.find((p) => p.id === id)?.nome ?? null;
  const quando = (s: SessaoDoPaciente, molde: string) =>
    format(dataDeParede(new Date(s.inicio), fusoDe(s.id)), t(molde), { locale: localeDaData });
  const equipe = resumo.equipe
    .map((id) => pessoas.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  const { proxima, reavaliacao, passadas } = resumo;
  const comQuem = (s: SessaoDoPaciente) => {
    const nome = nomeDe(s.donoId);
    return nome
      ? t("{tipo} com {nome}")
          .replace("{tipo}", s.tipo ?? s.titulo)
          .replace("{nome}", nome)
      : (s.tipo ?? s.titulo);
  };

  return (
    <section
      data-testid="resumo-do-paciente"
      aria-label={t("Resumo do paciente")}
      className="grid gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {resumo.modalidades.length > 0 && (
          <ul aria-label={t("Modalidades")} className="flex flex-wrap items-center gap-2">
            {resumo.modalidades.map((m) => (
              <li
                key={m}
                data-testid={`modalidade-do-paciente-${m}`}
                className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs text-text"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: corDaModalidade(m) }}
                />
                {t(ROTULO_DA_MODALIDADE[m])}
              </li>
            ))}
          </ul>
        )}
        {equipe.length > 0 && (
          <div
            data-testid="equipe-do-paciente"
            className="flex items-center gap-2 text-sm text-text-muted"
          >
            <span className="flex gap-1">
              {equipe.map((p) => (
                <AvatarDaPessoa key={p.id} pessoa={p} tamanho="sm" />
              ))}
            </span>
            <span>
              {juntarNomes(
                equipe.map((p) => p.nome),
                t,
              )}
            </span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao
          testid="cartao-proxima-sessao"
          rotulo={t("Próxima sessão")}
          vazio={!proxima}
          valor={
            proxima ? quando(proxima, "EEEE, d 'de' MMMM, HH:mm") : t("Nenhuma sessão marcada")
          }
          detalhe={
            proxima ? (
              <>
                {comQuem(proxima)}.{" "}
                {proxima.situacao === "pending" ? t("Aguardando confirmação.") : t("Confirmada.")}{" "}
                <Link
                  href={`/app/agenda?compromisso=${proxima.id}`}
                  className="font-medium text-text underline underline-offset-2"
                >
                  {t("Ver na agenda")}
                </Link>
              </>
            ) : undefined
          }
        />
        <Cartao
          testid="cartao-reavaliacao"
          rotulo={t("Reavaliação")}
          vazio={!reavaliacao}
          valor={reavaliacao ? quando(reavaliacao, "d 'de' MMMM") : t("Ainda não marcada")}
          detalhe={
            reavaliacao && nomeDe(reavaliacao.donoId)
              ? t("Com {nome}").replace("{nome}", nomeDe(reavaliacao.donoId)!)
              : undefined
          }
        />
        <Cartao
          testid="cartao-ultimos-dias"
          rotulo={t("Últimos 60 dias")}
          vazio={passadas.sessoes + passadas.faltas === 0}
          valor={
            passadas.sessoes + passadas.faltas === 0
              ? t("Nenhuma sessão")
              : t(passadas.sessoes === 1 ? "{n} sessão" : "{n} sessões").replace(
                  "{n}",
                  String(passadas.sessoes),
                )
          }
          detalhe={
            passadas.faltas > 0
              ? t(passadas.faltas === 1 ? "{n} falta" : "{n} faltas").replace(
                  "{n}",
                  String(passadas.faltas),
                )
              : passadas.sessoes > 0
                ? t("Nenhuma falta")
                : undefined
          }
        />
      </div>
    </section>
  );
}
