"use client";
/**
 * As regras da clínica, editadas pelo administrador (migrations 9002 e 9003).
 *
 * Três blocos de números (faltas e cancelamento, pacotes, alertas) num formulário só, e a lista
 * dos tipos de agendamento com modalidade e preço, salva linha a linha. Cada bloco diz se a regra
 * já vale ou se fica guardada para a parte do sistema que ainda vai chegar, porque um número que
 * a tela aceita e nada usa precisa dizer isso a quem o digita.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { RegrasDaClinica as Regras } from "@/lib/clinica/agenda";
import { MODALIDADES, ROTULO_DA_MODALIDADE, type Modalidade } from "@/lib/clinica/vocabulario";
import { parseReaisToCents } from "@/lib/money";

type Campo = {
  chave: keyof Regras;
  rotulo: string;
  unidade: string;
  min: number;
  max: number;
};

type Bloco = {
  id: string;
  titulo: string;
  situacao: "em_uso" | "guardado";
  aviso: string;
  campos: Campo[];
};

/** Faixas iguais aos CHECK de `clinica_politicas` e ao `politicaSchema`. */
const BLOCOS: Bloco[] = [
  {
    id: "faltas",
    titulo: "Faltas e cancelamento",
    situacao: "em_uso",
    aviso: "Já vale na agenda: a multa sai sozinha no cancelamento em cima da hora.",
    campos: [
      {
        chave: "antecedencia_cancelamento_horas",
        rotulo: "Cancelar sem multa até",
        unidade: "horas antes",
        min: 0,
        max: 168,
      },
      { chave: "multa_cancelamento_pct", rotulo: "Multa do cancelamento", unidade: "% da sessão", min: 0, max: 100 },
      {
        chave: "tolerancia_atraso_minutos",
        rotulo: "Tolerância de atraso",
        unidade: "minutos",
        min: 0,
        max: 120,
      },
    ],
  },
  {
    id: "pacotes",
    titulo: "Pacotes",
    situacao: "guardado",
    aviso: "Fica guardado e passa a valer quando os pacotes entrarem no sistema.",
    campos: [
      { chave: "pacote_sessoes_padrao", rotulo: "Sessões do pacote", unidade: "sessões", min: 1, max: 100 },
      { chave: "pacote_validade_dias", rotulo: "Validade do pacote", unidade: "dias", min: 1, max: 730 },
      { chave: "reposicoes_por_mes", rotulo: "Reposições no pilates", unidade: "por mês", min: 0, max: 31 },
      {
        chave: "congelamento_max_dias",
        rotulo: "Congelamento por viagem ou afastamento",
        unidade: "dias",
        min: 0,
        max: 180,
      },
      {
        chave: "sessoes_restantes_aviso_renovacao",
        rotulo: "Avisar a renovação quando restarem",
        unidade: "sessões",
        min: 0,
        max: 20,
      },
    ],
  },
  {
    id: "alertas",
    titulo: "Alertas de acompanhamento",
    situacao: "guardado",
    aviso: "Fica guardado e passa a valer quando os alertas entrarem no sistema.",
    campos: [
      { chave: "faltas_seguidas_alerta", rotulo: "Alertar a recepção depois de", unidade: "faltas seguidas", min: 1, max: 10 },
      { chave: "faltas_no_mes_abandono", rotulo: "Risco de abandono com", unidade: "faltas no mês", min: 1, max: 31 },
      {
        chave: "dias_sem_sessao_inativo",
        rotulo: "Paciente inativo depois de",
        unidade: "dias sem sessão",
        min: 1,
        max: 365,
      },
      {
        chave: "horas_evolucao_atrasada",
        rotulo: "Evolução atrasada depois de",
        unidade: "horas",
        min: 1,
        max: 168,
      },
    ],
  },
];

const CHAVE_REGRAS = ["clinica", "regras"];
const CHAVE_TIPOS = ["clinica", "tipos-atendimento"];
const CHAVE_PRECOS = ["clinica", "precos"];

const campo = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

export function RegrasDaClinica() {
  const t = useT();
  const [salvas, setSalvas] = useState(false);
  const regras = useQuery({
    queryKey: CHAVE_REGRAS,
    queryFn: async () =>
      (await apiClient.get<{ data: Regras & { personalizada: boolean } }>("/api/v1/clinica/politicas"))
        .data,
    retry: false,
  });

  if (regras.error instanceof ApiError && regras.error.code === "module_not_installed") {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {regras.error.message}
      </p>
    );
  }
  if (regras.isError) {
    return <p className="text-danger text-sm">{t("Não foi possível carregar as regras da clínica.")}</p>;
  }
  if (!regras.data) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* A chave remonta o formulário quando o servidor devolve regras novas: o rascunho
          recomeça do que foi salvo, sem efeito sincronizando estado. */}
      <FormularioDasRegras
        key={JSON.stringify(regras.data)}
        inicial={regras.data}
        salvas={salvas}
        aoMudar={() => setSalvas(false)}
        aoSalvar={() => setSalvas(true)}
      />
      <TiposDeAtendimento />
    </div>
  );
}

function FormularioDasRegras({
  inicial,
  salvas,
  aoMudar,
  aoSalvar,
}: {
  inicial: Regras;
  salvas: boolean;
  aoMudar: () => void;
  aoSalvar: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [valores, setValores] = useState<Record<string, string>>(() => paraTexto(inicial));

  const alterados = Object.fromEntries(
    BLOCOS.flatMap((b) => b.campos)
      .filter((c) => valores[c.chave] !== String(inicial[c.chave]))
      .map((c) => [c.chave, Number(valores[c.chave])]),
  );
  const invalidos = BLOCOS.flatMap((b) => b.campos).filter((c) => {
    const n = Number(valores[c.chave]);
    return valores[c.chave] === "" || !Number.isInteger(n) || n < c.min || n > c.max;
  });

  const salvar = useMutation({
    mutationFn: () => apiClient.put("/api/v1/clinica/politicas", alterados),
    onSuccess: () => {
      aoSalvar();
      void qc.invalidateQueries({ queryKey: CHAVE_REGRAS });
    },
    onError: showApiError,
  });

  const pode = !salvar.isPending && invalidos.length === 0 && Object.keys(alterados).length > 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) salvar.mutate();
      }}
    >
      {BLOCOS.map((bloco) => (
        <section
          key={bloco.id}
          className="flex flex-col gap-3 rounded-md border border-border p-3"
          data-testid={`bloco-${bloco.id}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{t(bloco.titulo)}</h2>
            <Badge variant={bloco.situacao === "em_uso" ? "success" : "secondary"}>
              {bloco.situacao === "em_uso" ? t("Em uso") : t("Guardado para depois")}
            </Badge>
          </div>
          <p className="text-xs text-text-muted">{t(bloco.aviso)}</p>
          <div className="flex flex-wrap gap-3">
            {bloco.campos.map((c) => {
              const invalido = invalidos.some((i) => i.chave === c.chave);
              return (
                <label key={c.chave} className="flex flex-col gap-1 text-xs text-text-muted">
                  {t(c.rotulo)}
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={c.min}
                      max={c.max}
                      step={1}
                      value={valores[c.chave] ?? ""}
                      aria-invalid={invalido}
                      data-testid={`regra-${c.chave}`}
                      onChange={(e) => {
                        aoMudar();
                        setValores((v) => ({ ...v, [c.chave]: e.target.value }));
                      }}
                      className={`${campo} w-24 ${invalido ? "border-danger" : ""}`}
                    />
                    <span className="text-sm text-text">{t(c.unidade)}</span>
                  </span>
                  {invalido ? (
                    <span className="text-danger">
                      {t("Use um número inteiro de {min} a {max}.")
                        .replace("{min}", String(c.min))
                        .replace("{max}", String(c.max))}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </section>
      ))}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!pode} data-testid="salvar-regras">
          {t("Salvar regras")}
        </Button>
        {salvas && Object.keys(alterados).length === 0 ? (
          <span className="text-sm text-text-muted" role="status">
            {t("Regras salvas.")}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function paraTexto(regras: Regras): Record<string, string> {
  return Object.fromEntries(
    BLOCOS.flatMap((b) => b.campos).map((c) => [c.chave, String(regras[c.chave])]),
  );
}

type TipoComModalidade = { event_type_id: string; nome: string; modalidade: Modalidade | null };
type TipoComPreco = { event_type_id: string; valor_cents: number | null; currency: string };

function TiposDeAtendimento() {
  const t = useT();
  const tipos = useQuery({
    queryKey: CHAVE_TIPOS,
    queryFn: async () =>
      (await apiClient.get<{ data: TipoComModalidade[] }>("/api/v1/clinica/tipos-atendimento")).data,
  });
  const precos = useQuery({
    queryKey: CHAVE_PRECOS,
    queryFn: async () =>
      (await apiClient.get<{ data: TipoComPreco[] }>("/api/v1/clinica/precos")).data,
  });

  const lista = tipos.data ?? [];
  const precoPorTipo = new Map((precos.data ?? []).map((p) => [p.event_type_id, p]));

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      data-testid="bloco-tipos"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{t("Modalidade e preço de cada atendimento")}</h2>
        <Badge variant="success">{t("Em uso")}</Badge>
      </div>
      <p className="text-xs text-text-muted">
        {t(
          "A modalidade pinta a agenda e liga a tolerância e a multa. O preço da sessão avulsa é a base da multa e só administradores o veem.",
        )}
      </p>
      {tipos.isError || precos.isError ? (
        <p className="text-danger text-sm">{t("Não foi possível carregar os tipos de atendimento.")}</p>
      ) : tipos.isLoading || precos.isLoading ? null : lista.length === 0 ? (
        <p className="text-sm text-text-muted">
          {t("Nenhum tipo de agendamento ativo. Crie os tipos em Configurações › Tipos de agendamento.")}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {lista.map((tipo) => (
            <LinhaDoTipo
              key={`${tipo.event_type_id}:${tipo.modalidade}:${precoPorTipo.get(tipo.event_type_id)?.valor_cents}`}
              tipo={tipo}
              preco={precoPorTipo.get(tipo.event_type_id)?.valor_cents ?? null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function centavosParaTexto(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

function LinhaDoTipo({ tipo, preco }: { tipo: TipoComModalidade; preco: number | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [modalidade, setModalidade] = useState<string>(tipo.modalidade ?? "");
  const [valor, setValor] = useState(centavosParaTexto(preco));

  const novoPreco = valor.trim() === "" ? null : parseReaisToCents(valor);
  const precoInvalido = valor.trim() !== "" && novoPreco === null;
  const mudouModalidade = modalidade !== (tipo.modalidade ?? "");
  const mudouPreco = !precoInvalido && novoPreco !== preco;

  const salvar = useMutation({
    mutationFn: async () => {
      if (mudouModalidade) {
        await apiClient.put("/api/v1/clinica/tipos-atendimento", {
          event_type_id: tipo.event_type_id,
          modalidade: modalidade === "" ? null : modalidade,
        });
      }
      if (mudouPreco) {
        await apiClient.put("/api/v1/clinica/precos", {
          event_type_id: tipo.event_type_id,
          valor_cents: novoPreco,
        });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_TIPOS });
      void qc.invalidateQueries({ queryKey: CHAVE_PRECOS });
    },
    onError: showApiError,
  });

  const pode = !salvar.isPending && !precoInvalido && (mudouModalidade || mudouPreco);

  return (
    <li
      className="flex flex-wrap items-end justify-between gap-2 py-2"
      data-testid={`tipo-${tipo.event_type_id}`}
    >
      <p className="min-w-40 flex-1 text-sm font-medium">{tipo.nome}</p>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Modalidade")}
        <select
          value={modalidade}
          data-testid="tipo-modalidade"
          onChange={(e) => setModalidade(e.target.value)}
          className={campo}
        >
          <option value="">{t("Não é atendimento da clínica")}</option>
          {MODALIDADES.map((m) => (
            <option key={m} value={m}>
              {t(ROTULO_DA_MODALIDADE[m])}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        {t("Preço da sessão (R$)")}
        <input
          value={valor}
          inputMode="decimal"
          placeholder="0,00"
          aria-invalid={precoInvalido}
          data-testid="tipo-preco"
          onChange={(e) => setValor(e.target.value)}
          className={`${campo} w-28 ${precoInvalido ? "border-danger" : ""}`}
        />
      </label>
      <Button
        variant="outline"
        size="sm"
        disabled={!pode}
        data-testid="salvar-tipo"
        onClick={() => salvar.mutate()}
      >
        {t("Salvar")}
      </Button>
    </li>
  );
}
