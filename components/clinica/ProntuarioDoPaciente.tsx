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

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  MODALIDADES,
  MODELO_DA_MODALIDADE,
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  type Modalidade,
  type TipoDeRegistro,
} from "@/lib/clinica/vocabulario";

type Registro = {
  id: string;
  modalidade: Modalidade;
  tipo: TipoDeRegistro;
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
};

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

export function ProntuarioDoPaciente({ contactId }: { contactId: string }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const eu = useClinicaEu();
  const profissional = eu.data?.profissional ?? null;
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
      <Card className="p-4 text-sm text-text-muted" role="status">
        {t(
          "O prontuário só é visível para profissionais de saúde cadastrados e ativos na clínica. O cadastro fica em Configurações › Profissionais de saúde.",
        )}
      </Card>
    );
  }
  if (registros.error instanceof ApiError) {
    return <Card className="text-danger p-4 text-sm">{registros.error.message}</Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <FormularioDeRegistro
        contactId={contactId}
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
                  {MODELO_DA_MODALIDADE[r.modalidade]
                    .filter((c) => r.conteudo[c.chave] !== undefined && r.conteudo[c.chave] !== "")
                    .map((c) => (
                      <div key={c.chave}>
                        <dt className="text-xs text-text-muted uppercase">{t(c.rotulo)}</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap">
                          {String(r.conteudo[c.chave])}
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
    </div>
  );
}

function FormularioDeRegistro({
  contactId,
  modalidades,
  adendoDe,
  aoCancelarAdendo,
  aoAssinar,
}: {
  contactId: string;
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

  const modalidade = adendoDe ? adendoDe.modalidade : modalidadeEscolhida;
  const campos = adendoDe ? [] : MODELO_DA_MODALIDADE[modalidade];

  const assinar = useMutation({
    mutationFn: () => {
      const preenchido: Record<string, string | number> = {};
      for (const c of campos) {
        const v = (conteudo[c.chave] ?? "").trim();
        if (v === "") continue;
        preenchido[c.chave] =
          c.tipo === "escala" || c.tipo === "numero" ? Number(v.replace(",", ".")) : v;
      }
      return apiClient.post("/api/v1/clinica/prontuario", {
        contact_id: contactId,
        modalidade,
        tipo: adendoDe ? "adendo" : tipo,
        adendo_de: adendoDe?.id ?? null,
        conteudo: preenchido,
        texto: texto.trim() || null,
      });
    },
    onSuccess: () => {
      setConteudo({});
      setTexto("");
      aoAssinar();
      void qc.invalidateQueries({ queryKey: ["clinica", "prontuario", contactId] });
    },
    onError: showApiError,
  });

  const algoPreenchido =
    texto.trim() !== "" || Object.values(conteudo).some((v) => v.trim() !== "");
  const campo = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

  return (
    <Card className="p-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (algoPreenchido && !assinar.isPending) assinar.mutate();
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
                onChange={(e) => setTipo(e.target.value as TipoDeRegistro)}
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

        {campos.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {campos.map((c) => (
              <label key={c.chave} className="flex flex-col gap-1 text-xs text-text-muted">
                {t(c.rotulo)}
                {c.tipo === "texto_longo" ? (
                  <textarea
                    rows={3}
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
            disabled={!algoPreenchido || assinar.isPending}
            data-testid="assinar-registro"
          >
            {t("Assinar registro")}
          </Button>
          <span className="text-xs text-text-muted">
            {t(
              "Depois de assinado, o registro não pode ser editado; correções entram como adendo.",
            )}
          </span>
        </div>
      </form>
    </Card>
  );
}
