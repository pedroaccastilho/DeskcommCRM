"use client";

/**
 * Escrever no prontuário pela interface nova: evolução da sessão (o caso de todo dia), avaliação
 * ou alta. Os campos são os mesmos modelos da interface atual (`modeloDoRegistro`), e quem carimba
 * a assinatura e recusa quem não pode é o banco (migration 9001). A dor e o esforço viram uma
 * régua de 0 a 10 de tocar, em vez de campo de número.
 */
import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import {
  ROTULO_DA_MODALIDADE,
  ROTULO_DO_TIPO,
  camposObrigatoriosFaltando,
  modeloDoRegistro,
  type CampoDoModelo,
  type Modalidade,
  type TipoDeRegistro,
} from "@/lib/clinica/vocabulario";

import { useNovo } from "./Casca";
import { useRecarregar } from "./dados";
import { Folha, primeiroNome } from "./pecas";

const TIPOS: TipoDeRegistro[] = ["evolucao", "avaliacao", "alta"];

export function FolhaDeEvolucao({
  contactId,
  nomeDoPaciente,
  appointmentId,
  modalidadeSugerida,
  aoFechar,
}: {
  contactId: string;
  nomeDoPaciente: string;
  appointmentId: string | null;
  modalidadeSugerida: Modalidade | null;
  aoFechar: () => void;
}) {
  const { eu } = useNovo();
  const recarregar = useRecarregar();
  const minhas = (eu?.profissional?.modalidades ?? []) as Modalidade[];
  const [modalidade, setModalidade] = React.useState<Modalidade | null>(
    modalidadeSugerida && minhas.includes(modalidadeSugerida)
      ? modalidadeSugerida
      : (minhas[0] ?? null),
  );
  const [tipo, setTipo] = React.useState<TipoDeRegistro>("evolucao");
  const [conteudo, setConteudo] = React.useState<Record<string, string | number>>({});
  const [texto, setTexto] = React.useState("");

  const campos = modalidade ? modeloDoRegistro(modalidade, tipo) : [];
  const faltando = modalidade ? camposObrigatoriosFaltando(modalidade, tipo, conteudo) : [];
  const algoEscrito =
    texto.trim() !== "" || Object.values(conteudo).some((v) => String(v).trim() !== "");

  const assinar = useMutation({
    mutationFn: async () =>
      apiClient.post("/api/v1/clinica/prontuario", {
        contact_id: contactId,
        modalidade,
        tipo,
        appointment_id: appointmentId,
        conteudo: Object.fromEntries(
          Object.entries(conteudo).filter(([, v]) => String(v).trim() !== ""),
        ),
        texto: texto.trim() || null,
      }),
    onSuccess: () => {
      toast.success(
        `${ROTULO_DO_TIPO[tipo]} assinada no prontuário de ${primeiroNome(nomeDoPaciente)}.`,
      );
      recarregar();
      aoFechar();
    },
    onError: (err) => showApiError(err),
  });

  if (!modalidade) {
    return (
      <Folha aberta aoFechar={aoFechar} titulo="Prontuário">
        <p className="n-suave text-sm">
          Só profissional de saúde cadastrado escreve no prontuário. O cadastro fica em
          Configurações › Profissionais de saúde.
        </p>
      </Folha>
    );
  }

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={`${ROTULO_DO_TIPO[tipo]} de ${primeiroNome(nomeDoPaciente)}`}
      subtitulo="Depois de assinado, o registro não se edita. Para corrigir, faça um adendo."
      testid="novo-folha-evolucao"
    >
      <div className="grid gap-5">
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

        {campos.map((c) => (
          <Campo
            key={`${tipo}-${c.chave}`}
            campo={c}
            valor={conteudo[c.chave]}
            aoMudar={(v) => setConteudo((atual) => ({ ...atual, [c.chave]: v }))}
          />
        ))}

        <label className="block">
          <span className="n-rotulo">Observações</span>
          <textarea
            className="n-campo"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="O que mais vale registrar desta sessão"
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
          Assinar {ROTULO_DO_TIPO[tipo].toLowerCase()}
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
