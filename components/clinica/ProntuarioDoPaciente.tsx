"use client";
/**
 * A ABA "PRONTUÁRIO" DA FICHA DO PACIENTE — módulo opcional clínica (fork TOQ, migration 9001).
 *
 * Linha do tempo de todos os registros clínicos do paciente (fisioterapia, pilates, medicina e
 * enfermagem juntos, com filtro), o formulário de registro para quem é profissional ativo, e o
 * adendo como único jeito de corrigir. Quem não é profissional vê a explicação, não um vazio:
 * a lista viria vazia pela RLS, e "sem registros" mentiria.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { chaveDosPlanos } from "@/components/clinica/PlanoDeTratamento";
import { useT } from "@/hooks/i18n/useT";
import { useLocaleDeData, useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { dataDeParede } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  MODALIDADES,
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  camposObrigatoriosFaltando,
  camposParaMostrar,
  modeloDoRegistro,
  valorParaMostrar,
  type Modalidade,
  type TipoDeRegistro,
} from "@/lib/clinica/vocabulario";

type Registro = {
  id: string;
  modalidade: Modalidade;
  tipo: TipoDeRegistro;
  appointment_id: string | null;
  adendo_de: string | null;
  conteudo: Record<string, string | number>;
  texto: string | null;
  autor_nome: string;
  autor_registro: string;
  assinado_em: string;
};

type Eu = {
  instalado: boolean;
  profissional: { modalidades: Modalidade[]; nome_profissional: string } | null;
  /** Administrador da clínica: vê quem abriu o prontuário, mesmo sem ser profissional. */
  ve_acessos?: boolean;
};

/** O que a assinatura de uma avaliação devolve sobre o retorno de reavaliação (migration 9006). */
type RetornoDaAssinatura = {
  situacao:
    "marcado" | "marcado_outro_dia" | "sem_horario" | "sem_tipo" | "a_marcar" | "nao_pedido";
  inicio: string | null;
  fuso: string | null;
  aviso: "enviado" | "nao_deu" | null;
};

type Acesso = { id: string; user_id: string | null; nome: string | null; acessado_em: string };

/** Uma sessão da agenda que já aconteceu e ainda não tem registro no prontuário. */
export type Pendencia = {
  appointment_id: string;
  titulo: string;
  comeca: string;
  situacao: string;
  /** Passaram mais de 24h da sessão sem evolução. */
  atrasada: boolean;
  contact_id: string;
  contato: { name: string | null; display_name: string | null; phone_number: string | null } | null;
};

/** Evoluções pendentes de quem está logado (vazia para quem não é profissional ativo). */
export function usePendencias(habilitado = true) {
  return useQuery({
    queryKey: ["clinica", "pendencias"],
    queryFn: async () =>
      (await apiClient.get<{ data: Pendencia[] }>("/api/v1/clinica/pendencias")).data,
    enabled: habilitado,
    retry: false,
  });
}

/** Os tipos que se escolhem no formulário; adendo nasce do botão no registro original. */
const TIPOS_DO_FORMULARIO: TipoDeRegistro[] = ["anamnese", "avaliacao", "evolucao", "alta"];

export function useClinicaEu() {
  return useQuery({
    queryKey: ["clinica", "eu"],
    queryFn: async () => (await apiClient.get<{ data: Eu }>("/api/v1/clinica/eu")).data,
    staleTime: 60_000,
    retry: false,
  });
}

export function ProntuarioDoPaciente({
  contactId,
  sessaoInicial,
}: {
  contactId: string;
  /** Sessão da agenda vinda do atalho "Registrar evolução": já entra vinculada ao formulário. */
  sessaoInicial?: string;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const eu = useClinicaEu();
  const profissional = eu.data?.profissional ?? null;
  const veAcessos = Boolean(eu.data?.ve_acessos);
  const [filtro, setFiltro] = useState<Modalidade | "todas">("todas");
  const [adendoDe, setAdendoDe] = useState<Registro | null>(null);

  const chave = ["clinica", "prontuario", contactId];
  const registros = useQuery({
    queryKey: chave,
    queryFn: async () =>
      (
        await apiClient.get<{ data: Registro[] }>(
          `/api/v1/clinica/prontuario?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
    enabled: Boolean(profissional),
    retry: false,
  });

  const visiveis = useMemo(
    () => (registros.data ?? []).filter((r) => filtro === "todas" || r.modalidade === filtro),
    [registros.data, filtro],
  );

  if (eu.isLoading) return null;
  if (!profissional) {
    return (
      <div className="flex flex-col gap-4">
        <Card className="p-4 text-sm text-text-muted" role="status">
          {t(
            "O prontuário só é visível para profissionais de saúde cadastrados e ativos na clínica. O cadastro fica em Configurações › Profissionais de saúde.",
          )}
        </Card>
        {veAcessos ? <TrilhaDeAcessos contactId={contactId} /> : null}
      </div>
    );
  }
  if (registros.error instanceof ApiError) {
    return <Card className="text-danger p-4 text-sm">{registros.error.message}</Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <FormularioDeRegistro
        contactId={contactId}
        sessaoInicial={sessaoInicial}
        modalidades={profissional.modalidades}
        adendoDe={adendoDe}
        aoCancelarAdendo={() => setAdendoDe(null)}
        aoAssinar={() => setAdendoDe(null)}
      />

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label={t("Filtrar por modalidade")}
      >
        <Button
          size="sm"
          variant={filtro === "todas" ? "default" : "outline"}
          onClick={() => setFiltro("todas")}
        >
          {t("Todas")}
        </Button>
        {MODALIDADES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={filtro === m ? "default" : "outline"}
            onClick={() => setFiltro(m)}
          >
            {t(ROTULO_DA_MODALIDADE[m])}
          </Button>
        ))}
        <Button size="sm" variant="outline" className="ml-auto" asChild>
          <a
            href={`/api/v1/clinica/prontuario/pdf?contact_id=${encodeURIComponent(contactId)}`}
            download
            data-testid="exportar-prontuario"
          >
            {t("Exportar PDF")}
          </a>
        </Button>
      </div>

      {registros.isLoading ? null : visiveis.length === 0 ? (
        <Card className="p-4 text-sm text-text-muted">{t("Nenhum registro ainda.")}</Card>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="prontuario-linha-do-tempo">
          {visiveis.map((r) => (
            <li key={r.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{t(ROTULO_DA_MODALIDADE[r.modalidade])}</Badge>
                    <span className="text-sm font-medium">{t(ROTULO_DO_TIPO[r.tipo])}</span>
                    {r.appointment_id ? (
                      <Badge variant="outline">{t("Sessão da agenda")}</Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(r.assinado_em).toLocaleString(tagDoIdioma)}
                  </span>
                </div>
                {r.adendo_de ? (
                  <p className="mt-1 text-xs text-text-muted">
                    {t("Adendo a um registro anterior")}
                  </p>
                ) : null}
                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                  {camposParaMostrar(r.modalidade, r.tipo)
                    .filter((c) => r.conteudo[c.chave] !== undefined && r.conteudo[c.chave] !== "")
                    .map((c) => (
                      <div key={c.chave}>
                        <dt className="text-xs text-text-muted uppercase">{t(c.rotulo)}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap">
                          {c.opcoes
                            ? t(valorParaMostrar(c, r.conteudo[c.chave]!))
                            : valorParaMostrar(c, r.conteudo[c.chave]!)}
                        </dd>
                      </div>
                    ))}
                </dl>
                {r.texto ? <p className="mt-3 text-sm whitespace-pre-wrap">{r.texto}</p> : null}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <span className="text-xs text-text-muted">
                    {t("Assinado por")} {r.autor_nome} · {r.autor_registro}
                  </span>
                  {r.tipo !== "adendo" && profissional.modalidades.includes(r.modalidade) ? (
                    <Button size="sm" variant="ghost" onClick={() => setAdendoDe(r)}>
                      {t("Adicionar adendo")}
                    </Button>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {veAcessos ? <TrilhaDeAcessos contactId={contactId} /> : null}
    </div>
  );
}

const ACESSOS_VISIVEIS = 10;

/**
 * Quem abriu o prontuário deste paciente, e quando: ler na tela ou exportar o PDF grava uma linha.
 * Só o administrador da clínica vê (RLS de `prontuario_acessos`).
 */
function TrilhaDeAcessos({ contactId }: { contactId: string }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const [todos, setTodos] = useState(false);
  const acessos = useQuery({
    queryKey: ["clinica", "acessos", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Acesso[] }>(
          `/api/v1/clinica/acessos?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
    retry: false,
  });

  const lista = acessos.data ?? [];
  const visiveis = todos ? lista : lista.slice(0, ACESSOS_VISIVEIS);

  return (
    <Card className="p-4" data-testid="prontuario-acessos">
      <h3 className="text-sm font-medium">{t("Quem abriu este prontuário")}</h3>
      <p className="mt-0.5 text-xs text-text-muted">
        {t("Cada leitura na tela e cada PDF exportado ficam registrados. Só o administrador vê.")}
      </p>
      {acessos.error instanceof ApiError ? (
        <p className="text-danger mt-3 text-sm">{acessos.error.message}</p>
      ) : acessos.isLoading ? null : lista.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{t("Ninguém abriu este prontuário ainda.")}</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col divide-y divide-border/60 text-sm">
            {visiveis.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{a.nome ?? t("Profissional removido")}</span>
                <span className="text-xs text-text-muted">
                  {new Date(a.acessado_em).toLocaleString(tagDoIdioma)}
                </span>
              </li>
            ))}
          </ul>
          {lista.length > ACESSOS_VISIVEIS ? (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setTodos(!todos)}>
              {todos ? t("Mostrar menos") : t("Ver todos")}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}

function FormularioDeRegistro({
  contactId,
  sessaoInicial,
  modalidades,
  adendoDe,
  aoCancelarAdendo,
  aoAssinar,
}: {
  contactId: string;
  sessaoInicial?: string;
  modalidades: Modalidade[];
  adendoDe: Registro | null;
  aoCancelarAdendo: () => void;
  aoAssinar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [modalidadeEscolhida, setModalidade] = useState<Modalidade>(
    modalidades[0] ?? "fisioterapia",
  );
  const [tipo, setTipo] = useState<TipoDeRegistro>("evolucao");
  const [conteudo, setConteudo] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState("");
  const [sessao, setSessao] = useState<string | null>(sessaoInicial ?? null);
  const tagDoIdioma = useTagDeIdioma();
  const pendencias = usePendencias(Boolean(sessao));
  const localeDaData = useLocaleDeData();

  /** O retorno marcado ao assinar a avaliação, dito na hora para quem assinou. */
  const avisarDoRetorno = (r: RetornoDaAssinatura | null) => {
    if (!r) return;
    if ((r.situacao === "marcado" || r.situacao === "marcado_outro_dia") && r.inicio) {
      const quando = format(
        dataDeParede(new Date(r.inicio), r.fuso ?? "UTC"),
        t("EEEE, d 'de' MMMM, HH:mm"),
        { locale: localeDaData },
      );
      toast.success(t("Retorno de reavaliação marcado: {quando}.").replace("{quando}", quando), {
        description:
          r.situacao === "marcado_outro_dia"
            ? t(
                "O dia pedido estava cheio; ficou no horário livre mais próximo. A recepção foi avisada.",
              )
            : r.aviso === "enviado"
              ? t("Paciente avisado pelo WhatsApp.")
              : t("A confirmação pelo WhatsApp não saiu; a recepção vai avisar o paciente."),
      });
      return;
    }
    if (r.situacao === "sem_horario" || r.situacao === "sem_tipo") {
      toast.warning(
        t("O retorno não pôde ser marcado sozinho. A recepção recebeu uma tarefa para marcar."),
      );
    }
  };
  const sessaoVinculada = pendencias.data?.find((p) => p.appointment_id === sessao);

  const modalidade = adendoDe ? adendoDe.modalidade : modalidadeEscolhida;
  const campos = adendoDe ? [] : modeloDoRegistro(modalidade, tipo);

  const assinar = useMutation({
    mutationFn: () => {
      const preenchido: Record<string, string | number> = {};
      for (const c of campos) {
        const v = (conteudo[c.chave] ?? "").trim();
        if (v === "") continue;
        preenchido[c.chave] =
          c.tipo === "escala" || c.tipo === "numero" ? Number(v.replace(",", ".")) : v;
      }
      return apiClient.post<{ data: { retorno?: RetornoDaAssinatura | null } }>(
        "/api/v1/clinica/prontuario",
        {
          contact_id: contactId,
          modalidade,
          tipo: adendoDe ? "adendo" : tipo,
          appointment_id: adendoDe ? null : sessao,
          adendo_de: adendoDe?.id ?? null,
          conteudo: preenchido,
          texto: texto.trim() || null,
        },
      );
    },
    onSuccess: (resposta) => {
      avisarDoRetorno(resposta.data?.retorno ?? null);
      setConteudo({});
      setTexto("");
      setSessao(null);
      aoAssinar();
      void qc.invalidateQueries({ queryKey: ["clinica", "prontuario", contactId] });
      void qc.invalidateQueries({ queryKey: ["clinica", "pendencias"] });
      void qc.invalidateQueries({ queryKey: chaveDosPlanos(contactId) });
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
    onError: showApiError,
  });

  const algoPreenchido =
    texto.trim() !== "" || Object.values(conteudo).some((v) => v.trim() !== "");
  const faltando = adendoDe ? [] : camposObrigatoriosFaltando(modalidade, tipo, conteudo);
  const podeAssinar = algoPreenchido && faltando.length === 0;
  const campo = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (podeAssinar && !assinar.isPending) assinar.mutate();
        }}
      >
        {adendoDe ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {t("Adendo")} · {t(ROTULO_DO_TIPO[adendoDe.tipo])} ·{" "}
              {t(ROTULO_DA_MODALIDADE[adendoDe.modalidade])}
            </h2>
            <Button type="button" size="sm" variant="ghost" onClick={aoCancelarAdendo}>
              {t("Cancelar")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <h2 className="w-full text-sm font-semibold">{t("Novo registro")}</h2>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              {t("Modalidade")}
              <select
                value={modalidade}
                data-testid="registro-modalidade"
                onChange={(e) => {
                  setModalidade(e.target.value as Modalidade);
                  setConteudo({});
                }}
                className={campo}
              >
                {modalidades.map((m) => (
                  <option key={m} value={m}>
                    {t(ROTULO_DA_MODALIDADE[m])}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              {t("Tipo")}
              <select
                value={tipo}
                data-testid="registro-tipo"
                onChange={(e) => {
                  setTipo(e.target.value as TipoDeRegistro);
                  setConteudo({});
                }}
                className={campo}
              >
                {TIPOS_DO_FORMULARIO.map((x) => (
                  <option key={x} value={x}>
                    {t(ROTULO_DO_TIPO[x])}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {sessao && !adendoDe ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-elevated px-3 py-2 text-xs"
            data-testid="registro-sessao"
          >
            <span>
              {t("Vinculado à sessão da agenda")}
              {sessaoVinculada
                ? ` · ${new Date(sessaoVinculada.comeca).toLocaleString(tagDoIdioma)}`
                : ""}
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSessao(null)}>
              {t("Desvincular")}
            </Button>
          </div>
        ) : null}

        {campos.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {campos.map((c) => (
              <label key={c.chave} className="flex flex-col gap-1 text-xs text-text-muted">
                <span>
                  {t(c.rotulo)}
                  {c.obrigatorio ? <span aria-hidden> *</span> : null}
                </span>
                {c.tipo === "opcoes" ? (
                  <select
                    value={conteudo[c.chave] ?? ""}
                    required={c.obrigatorio}
                    onChange={(e) => setConteudo((v) => ({ ...v, [c.chave]: e.target.value }))}
                    className={campo}
                  >
                    <option value="">{t("Escolha")}</option>
                    {(c.opcoes ?? []).map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {t(o.rotulo)}
                      </option>
                    ))}
                  </select>
                ) : c.tipo === "data" ? (
                  <input
                    type="date"
                    value={conteudo[c.chave] ?? ""}
                    data-testid={`registro-campo-${c.chave}`}
                    onChange={(e) => setConteudo((v) => ({ ...v, [c.chave]: e.target.value }))}
                    className={campo}
                  />
                ) : c.tipo === "texto_longo" ? (
                  <textarea
                    rows={3}
                    required={c.obrigatorio}
                    value={conteudo[c.chave] ?? ""}
                    onChange={(e) => setConteudo((v) => ({ ...v, [c.chave]: e.target.value }))}
                    className={campo}
                  />
                ) : (
                  <input
                    value={conteudo[c.chave] ?? ""}
                    inputMode={c.tipo === "texto" ? "text" : "decimal"}
                    type={c.tipo === "escala" ? "number" : "text"}
                    min={c.tipo === "escala" ? 0 : undefined}
                    max={c.tipo === "escala" ? 10 : undefined}
                    onChange={(e) => setConteudo((v) => ({ ...v, [c.chave]: e.target.value }))}
                    className={campo}
                  />
                )}
              </label>
            ))}
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {adendoDe ? t("Texto do adendo") : t("Observações")}
          <textarea
            rows={adendoDe ? 4 : 3}
            value={texto}
            data-testid="registro-texto"
            onChange={(e) => setTexto(e.target.value)}
            className={campo}
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!podeAssinar || assinar.isPending}
            data-testid="assinar-registro"
          >
            {t("Assinar registro")}
          </Button>
          <span className="text-xs text-text-muted">
            {faltando.length > 0 && algoPreenchido
              ? `${t("Falta preencher")}: ${faltando.map((f) => t(f)).join(", ")}`
              : t(
                  "Depois de assinado, o registro não pode ser editado; correções entram como adendo.",
                )}
          </span>
        </div>
      </form>
    </Card>
  );
}
