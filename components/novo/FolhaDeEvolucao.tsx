"use client";

/**
 * Escrever no prontuário pela interface nova: evolução da sessão (o caso de todo dia), anamnese,
 * avaliação ou alta, e o ADENDO a um registro já assinado (o único jeito de corrigir um). Os campos são os mesmos modelos da interface atual (`modeloDoRegistro`), e quem carimba
 * a assinatura e recusa quem não pode é o banco (migration 9001). A dor e o esforço viram uma
 * régua de 0 a 10 de tocar, em vez de campo de número.
 *
 * Em cima, a ÚLTIMA SESSÃO da modalidade e o "Repetir a conduta" do Meu dia da versão atual:
 * copia só o que se repete de uma sessão para outra (o tratamento), nunca o que se mede de novo.
 */
import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { ultimoRegistro, valoresParaRepetir } from "@/lib/clinica/meu-dia";
import {
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  camposObrigatoriosFaltando,
  camposParaMostrar,
  modeloDoRegistro,
  valorParaMostrar,
  type CampoDoModelo,
  type Modalidade,
  type TipoDeRegistro,
} from "@/lib/clinica/vocabulario";

import { useNovo } from "./Casca";
import { useProntuario, useRecarregar, type RegistroDoProntuario } from "./dados";
import { Folha, dataLonga, hora, primeiroNome } from "./pecas";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

const TIPOS: TipoDeRegistro[] = ["evolucao", "anamnese", "avaliacao", "alta"];

/** O que a assinatura de uma avaliação devolve sobre o retorno de reavaliação (migration 9006). */
type RetornoDaAssinatura = {
  situacao:
    "marcado" | "marcado_outro_dia" | "sem_horario" | "sem_tipo" | "a_marcar" | "nao_pedido";
  inicio: string | null;
  fuso: string | null;
  aviso: "enviado" | "nao_deu" | null;
};

export function FolhaDeEvolucao({
  contactId,
  nomeDoPaciente,
  appointmentId,
  modalidadeSugerida,
  aoFechar,
  aoAssinar,
  adendoDe = null,
}: {
  contactId: string;
  nomeDoPaciente: string;
  appointmentId: string | null;
  modalidadeSugerida: Modalidade | null;
  aoFechar: () => void;
  /** Depois de assinar; sem ele, a folha só fecha. A folha da sessão pergunta o próximo passo. */
  aoAssinar?: () => void;
  /** O registro assinado que este adendo corrige; com ele, a folha só pede o texto. */
  adendoDe?: RegistroDoProntuario | null;
}) {
  const t = useT();
  const tag = useTagDeIdioma();
  const { eu, fuso } = useNovo();
  const recarregar = useRecarregar();
  const minhas = (eu?.profissional?.modalidades ?? []) as Modalidade[];
  const [modalidadeEscolhida, setModalidade] = React.useState<Modalidade | null>(
    modalidadeSugerida && minhas.includes(modalidadeSugerida)
      ? modalidadeSugerida
      : (minhas[0] ?? null),
  );
  const [tipoEscolhido, setTipo] = React.useState<TipoDeRegistro>("evolucao");
  const modalidade = adendoDe ? adendoDe.modalidade : modalidadeEscolhida;
  const tipo: TipoDeRegistro = adendoDe ? "adendo" : tipoEscolhido;
  const [conteudo, setConteudo] = React.useState<Record<string, string | number>>({});
  const [texto, setTexto] = React.useState("");

  const registros = useProntuario(contactId, minhas.length > 0);
  const ultimo = modalidade && !adendoDe ? ultimoRegistro(registros.data ?? [], modalidade) : null;
  const campos = modalidade ? modeloDoRegistro(modalidade, tipo) : [];
  // Só o que o formulário de agora tem, e ainda não está igual ao que seria copiado.
  const repetiveis = Object.entries(valoresParaRepetir(ultimo)).filter(
    ([chave, valor]) =>
      campos.some((c) => c.chave === chave) &&
      String(conteudo[chave] ?? "").trim() !== valor.trim(),
  );
  const camposDoUltimo = ultimo
    ? camposParaMostrar(ultimo.modalidade, ultimo.tipo)
        .filter((c) => ultimo.conteudo[c.chave] !== undefined && ultimo.conteudo[c.chave] !== "")
        .slice(0, 4)
    : [];
  const faltando = modalidade ? camposObrigatoriosFaltando(modalidade, tipo, conteudo) : [];
  const algoEscrito =
    texto.trim() !== "" || Object.values(conteudo).some((v) => String(v).trim() !== "");

  /** O retorno marcado ao assinar a avaliação, dito na hora para quem assinou. */
  const avisarDoRetorno = (r: RetornoDaAssinatura | null | undefined) => {
    if (!r) return;
    if ((r.situacao === "marcado" || r.situacao === "marcado_outro_dia") && r.inicio) {
      const fusoDoRetorno = r.fuso ?? fuso;
      const quando = `${dataLonga(r.inicio, fusoDoRetorno, tag)}, ${hora(r.inicio, fusoDoRetorno)}`;
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

  const assinar = useMutation({
    mutationFn: async () =>
      apiClient.post<{ data: { retorno?: RetornoDaAssinatura | null } }>(
        "/api/v1/clinica/prontuario",
        {
          contact_id: contactId,
          modalidade,
          tipo,
          appointment_id: adendoDe ? null : appointmentId,
          adendo_de: adendoDe?.id ?? null,
          conteudo: Object.fromEntries(
            Object.entries(conteudo).filter(([, v]) => String(v).trim() !== ""),
          ),
          texto: texto.trim() || null,
        },
      ),
    onSuccess: (resposta) => {
      toast.success(
        adendoDe
          ? `Adendo assinado no prontuário de ${primeiroNome(nomeDoPaciente)}.`
          : `${ROTULO_DO_TIPO[tipo]} assinada no prontuário de ${primeiroNome(nomeDoPaciente)}.`,
      );
      avisarDoRetorno(resposta.data?.retorno);
      recarregar();
      (aoAssinar ?? aoFechar)();
    },
    onError: (err) => showApiError(err),
  });

  if (!modalidade) {
    return (
      <Folha aberta aoFechar={aoFechar} titulo="Prontuário">
        <p className="n-suave text-sm">
          {t(
            "Só profissional de saúde cadastrado escreve no prontuário. O cadastro fica em Configurações › Profissionais de saúde.",
          )}
        </p>
      </Folha>
    );
  }

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={`${ROTULO_DO_TIPO[tipo]} de ${primeiroNome(nomeDoPaciente)}`}
      subtitulo={
        adendoDe
          ? "O registro original fica como está; o adendo entra logo abaixo dele, assinado por você."
          : "Depois de assinado, o registro não se edita. Para corrigir, faça um adendo."
      }
      testid="novo-folha-evolucao"
    >
      <div className="grid gap-5">
        {adendoDe ? (
          <div className="rounded-[20px] bg-[var(--n-papel)] p-4" data-testid="novo-adendo-de">
            <p className="text-sm font-bold">
              {t("Adendo a")} {ROTULO_DO_TIPO[adendoDe.tipo].toLowerCase()}{" "}
              <span className="n-fraco font-semibold">
                · {ROTULO_DA_MODALIDADE[adendoDe.modalidade]} ·{" "}
                {dataLonga(adendoDe.assinado_em, fuso, tag).split(",")[0]}
              </span>
            </p>
            <p className="n-suave mt-1 text-xs">
              {t("Assinado por")} {adendoDe.autor_nome}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {TIPOS.map((t) => (
              <button
                key={t}
                type="button"
                className="n-chip"
                aria-pressed={t === tipo}
                onClick={() => {
                  setTipo(t);
                  setConteudo({});
                }}
              >
                {ROTULO_DO_TIPO[t]}
              </button>
            ))}
            {minhas.length > 1 && <span className="mx-1 w-px bg-[var(--n-linha)]" aria-hidden />}
            {minhas.length > 1 &&
              minhas.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="n-chip"
                  aria-pressed={m === modalidade}
                  onClick={() => {
                    setModalidade(m);
                    setConteudo({});
                  }}
                >
                  {ROTULO_DA_MODALIDADE[m]}
                </button>
              ))}
          </div>
        )}

        {ultimo && (
          <div className="rounded-[20px] bg-[var(--n-papel)] p-4" data-testid="novo-ultima-sessao">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold">
                {t("Última sessão")}{" "}
                <span className="n-fraco font-semibold">
                  · {ROTULO_DO_TIPO[ultimo.tipo]} ·{" "}
                  {dataLonga(ultimo.assinado_em, fuso, tag).split(",")[0]}
                </span>
              </p>
              {tipo === "evolucao" && repetiveis.length > 0 && (
                <button
                  type="button"
                  className="n-botao n-botao-suave n-botao-pequeno"
                  onClick={() =>
                    setConteudo((atual) => ({ ...atual, ...Object.fromEntries(repetiveis) }))
                  }
                  data-testid="novo-repetir-conduta"
                >
                  {t("Repetir a conduta")}
                </button>
              )}
            </div>
            <dl className="mt-2 grid gap-1.5 text-sm">
              {camposDoUltimo.map((c) => (
                <div key={c.chave}>
                  <dt className="n-fraco text-xs">{c.rotulo}</dt>
                  <dd className="whitespace-pre-wrap">
                    {valorParaMostrar(c, ultimo.conteudo[c.chave]!)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {campos.map((c) => (
          <Campo
            key={`${tipo}-${c.chave}`}
            campo={c}
            valor={conteudo[c.chave]}
            aoMudar={(v) => setConteudo((atual) => ({ ...atual, [c.chave]: v }))}
          />
        ))}

        <label className="block">
          <span className="n-rotulo">{adendoDe ? t("Texto do adendo") : t("Observações")}</span>
          <textarea
            className="n-campo"
            rows={adendoDe ? 5 : undefined}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={
              adendoDe
                ? t("O que corrigir ou acrescentar ao registro")
                : t("O que mais vale registrar desta sessão")
            }
            data-testid="novo-texto-do-registro"
          />
        </label>

        {faltando.length > 0 && (
          <p className="n-fraco text-xs">Falta preencher: {faltando.join(", ")}.</p>
        )}
        <button
          type="button"
          className="n-botao n-botao-principal w-full"
          disabled={!algoEscrito || faltando.length > 0 || assinar.isPending}
          onClick={() => assinar.mutate()}
        >
          {adendoDe ? t("Assinar o adendo") : `Assinar ${ROTULO_DO_TIPO[tipo].toLowerCase()}`}
        </button>
      </div>
    </Folha>
  );
}

function Campo({
  campo,
  valor,
  aoMudar,
}: {
  campo: CampoDoModelo;
  valor: string | number | undefined;
  aoMudar: (v: string | number) => void;
}) {
  const rotulo = (
    <span className="n-rotulo">
      {campo.rotulo}
      {campo.obrigatorio && <span className="text-[var(--n-alerta)]"> *</span>}
    </span>
  );
  if (campo.tipo === "escala") {
    return (
      <div>
        {rotulo}
        <div className="grid grid-cols-11 gap-1" role="group" aria-label={campo.rotulo}>
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              aria-pressed={valor === n}
              onClick={() => aoMudar(n)}
              className="n-numero rounded-xl py-2.5 text-sm font-bold transition-colors"
              style={{
                background:
                  valor === n
                    ? `color-mix(in oklab, var(--n-ok) ${100 - n * 6}%, var(--n-alerta))`
                    : "var(--n-papel)",
                color: valor === n ? "#fff" : undefined,
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (campo.tipo === "opcoes") {
    return (
      <div>
        {rotulo}
        <div className="flex flex-wrap gap-2">
          {campo.opcoes?.map((o) => (
            <button
              key={o.valor}
              type="button"
              className="n-chip"
              aria-pressed={valor === o.valor}
              onClick={() => aoMudar(o.valor)}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (campo.tipo === "texto_longo") {
    return (
      <label className="block">
        {rotulo}
        <textarea
          className="n-campo"
          value={String(valor ?? "")}
          onChange={(e) => aoMudar(e.target.value)}
        />
      </label>
    );
  }
  return (
    <label className="block">
      {rotulo}
      <input
        className="n-campo"
        inputMode={campo.tipo === "numero" ? "decimal" : undefined}
        value={String(valor ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          aoMudar(
            campo.tipo === "numero" && v.trim() !== "" && !Number.isNaN(Number(v.replace(",", ".")))
              ? Number(v.replace(",", "."))
              : v,
          );
        }}
      />
    </label>
  );
}
