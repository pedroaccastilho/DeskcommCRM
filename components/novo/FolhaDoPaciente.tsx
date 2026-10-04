"use client";

/**
 * CADASTRO DO PACIENTE na interface nova: uma folha só para criar e para corrigir. Os campos são os
 * que a recepção pergunta no balcão (nome, WhatsApp, nascimento, e-mail, CPF) mais POR ONDE o
 * paciente chegou, que alimenta o relatório de origens. As rotas são as mesmas da interface atual:
 * `POST`/`PATCH /api/v1/contacts` e `PUT /api/v1/clinica/pacientes/{id}/origem`.
 *
 * O telefone é digitado como a recepção fala ("(11) 98888-7777") e vira E.164 aqui; a origem só
 * aparece com o módulo clínica instalado (sem ele a rota responde 409 e a seção some).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import { COMPLEMENTO_DO_TIPO, PERGUNTA_DO_DETALHE } from "@/lib/clinica/origens";
import { nomeDoContato, rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { useT } from "@/lib/i18n/IdiomaProvider";
import { telefoneParaE164 } from "@/lib/novo/telefone";
import { randomId } from "@/lib/random-id";
import type { ContactCreate, ContactPatch } from "@/lib/schemas/contacts";
import type { Contact } from "@/lib/types/contacts";

import {
  useBuscaDePacientes,
  useOrigemDoPaciente,
  useOrigensDaClinica,
  useRecarregar,
} from "./dados";
import { Avatar, Folha, primeiroNome } from "./pecas";

export function FolhaDoPaciente({
  aberta,
  aoFechar,
  paciente,
  aoCriar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  /** Sem paciente = cadastro novo. */
  paciente?: Contact | null;
  aoCriar?: (id: string) => void;
}) {
  return aberta ? (
    <Conteudo aoFechar={aoFechar} paciente={paciente ?? null} aoCriar={aoCriar} />
  ) : null;
}

interface Indicador {
  id: string;
  nome: string;
}

function Conteudo({
  aoFechar,
  paciente,
  aoCriar,
}: {
  aoFechar: () => void;
  paciente: Contact | null;
  aoCriar?: (id: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const recarregar = useRecarregar();
  const [chave] = React.useState(() => randomId());
  const novo = paciente === null;

  const [nome, setNome] = React.useState(paciente ? (nomeDoContato(paciente) ?? "") : "");
  const [telefone, setTelefone] = React.useState(paciente?.phone_number ?? "");
  const [email, setEmail] = React.useState(paciente?.email ?? "");
  const [nascimento, setNascimento] = React.useState(paciente?.birthdate?.slice(0, 10) ?? "");
  const [cpf, setCpf] = React.useState("");
  const [etiquetas, setEtiquetas] = React.useState((paciente?.tags ?? []).join(", "));

  const origens = useOrigensDaClinica();
  const atual = useOrigemDoPaciente(paciente?.id ?? null);
  const [origemId, setOrigemId] = React.useState<string | null>(null);
  const [detalhe, setDetalhe] = React.useState("");
  const [indicador, setIndicador] = React.useState<Indicador | null>(null);
  const [buscaIndicador, setBuscaIndicador] = React.useState("");
  const candidatos = useBuscaDePacientes(buscaIndicador);
  const [preenchido, setPreenchido] = React.useState(false);
  // A origem já gravada chega depois: preenche uma vez, durante a renderização (o padrão do React
  // para estado que deriva de dado novo), sem atropelar o que a recepção já mexeu.
  if (!preenchido && atual.data) {
    setPreenchido(true);
    if (!atual.data.automatica && atual.data.origem) {
      setOrigemId(atual.data.origem.id);
      setDetalhe(atual.data.detalhe ?? "");
      setIndicador(atual.data.indicado_por);
    }
  }

  const listaDeOrigens = (origens.data ?? []).filter((o) => o.ativo || o.id === origemId);
  const origem = listaDeOrigens.find((o) => o.id === origemId) ?? null;
  const complemento = origem ? COMPLEMENTO_DO_TIPO[origem.tipo] : null;
  const pergunta = origem ? PERGUNTA_DO_DETALHE[origem.tipo] : null;

  const telefoneE164 = telefone.trim() === "" ? null : telefoneParaE164(telefone);
  const problemas: string[] = [];
  if (nome.trim() === "") problemas.push(t("Escreva o nome do paciente."));
  if (telefone.trim() !== "" && !telefoneE164)
    problemas.push(t("Confira o telefone: DDD e número, como (11) 98888-7777."));
  if (complemento === "detalhe" && detalhe.trim() === "" && origem?.tipo !== "outro")
    problemas.push(
      origem?.tipo === "encaminhamento"
        ? t("Informe qual médico encaminhou o paciente.")
        : t("Informe qual influenciador ou anúncio trouxe o paciente."),
    );
  if (complemento === "indicado_por" && !indicador)
    problemas.push(t("Escolha o paciente que indicou."));

  const origemMudou =
    origemId !== null &&
    (origemId !== (atual.data?.automatica ? null : (atual.data?.origem?.id ?? null)) ||
      detalhe.trim() !== (atual.data?.detalhe ?? "") ||
      (indicador?.id ?? null) !== (atual.data?.indicado_por?.id ?? null));

  const salvar = useMutation({
    mutationFn: async () => {
      const tags = etiquetas
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      let id = paciente?.id ?? null;
      if (novo) {
        const corpo: ContactCreate = { name: nome.trim(), source: "manual", tags };
        if (telefoneE164) corpo.phone_number = telefoneE164;
        if (email.trim()) corpo.email = email.trim();
        if (nascimento) corpo.birthdate = nascimento;
        if (cpf.replace(/\D/g, "")) corpo.cpf = cpf.replace(/\D/g, "");
        const r = await apiClient.post<{ data: { contact: Contact } }>("/api/v1/contacts", corpo, {
          idempotencyKey: chave,
        });
        id = r.data.contact.id;
      } else {
        const patch: ContactPatch = {};
        if (nome.trim() !== (nomeDoContato(paciente!) ?? "")) patch.name = nome.trim();
        if (telefoneE164 && telefoneE164 !== paciente!.phone_number)
          patch.phone_number = telefoneE164;
        if (email.trim() && email.trim() !== paciente!.email) patch.email = email.trim();
        if (nascimento && nascimento !== paciente!.birthdate?.slice(0, 10))
          patch.birthdate = nascimento;
        if (cpf.replace(/\D/g, "")) patch.cpf = cpf.replace(/\D/g, "");
        if (tags.join(",") !== (paciente!.tags ?? []).join(",")) patch.tags = tags;
        if (Object.keys(patch).length > 0)
          await apiClient.patch(`/api/v1/contacts/${encodeURIComponent(id!)}`, patch);
      }
      if (origemMudou && id) {
        await apiClient.put(`/api/v1/clinica/pacientes/${encodeURIComponent(id)}/origem`, {
          origem_id: origemId,
          detalhe: complemento === "detalhe" || origem?.tipo === "outro" ? detalhe.trim() : null,
          indicado_por_contact_id: complemento === "indicado_por" ? indicador?.id : null,
        });
      }
      return id!;
    },
    onSuccess: (id) => {
      toast.success(
        novo ? `${primeiroNome(nome.trim())} ${t("cadastrado.")}` : t("Cadastro atualizado."),
      );
      void qc.invalidateQueries({ queryKey: ["contacts"] });
      recarregar();
      aoFechar();
      if (novo) aoCriar?.(id);
    },
    onError: (err) => showApiError(err),
  });

  return (
    <Folha
      aberta
      aoFechar={aoFechar}
      titulo={novo ? t("Novo paciente") : t("Editar cadastro")}
      subtitulo={novo ? t("Só o nome é obrigatório. O resto dá para completar depois.") : undefined}
      testid="novo-folha-paciente"
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (problemas.length === 0) salvar.mutate();
        }}
      >
        <Campo rotulo={t("Nome")}>
          <input
            className="n-campo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoFocus
            autoComplete="off"
            data-testid="novo-paciente-nome"
          />
        </Campo>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            rotulo={t("WhatsApp")}
            erro={
              telefone.trim() !== "" && !telefoneE164
                ? t("DDD e número, ex.: (11) 98888-7777")
                : null
            }
          >
            <input
              className="n-campo"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              inputMode="tel"
              placeholder="(11) 98888-7777"
              autoComplete="off"
              data-testid="novo-paciente-telefone"
            />
          </Campo>
          <Campo rotulo={t("Data de nascimento")}>
            <input
              className="n-campo"
              type="date"
              value={nascimento}
              onChange={(e) => setNascimento(e.target.value)}
              data-testid="novo-paciente-nascimento"
            />
          </Campo>
          <Campo rotulo={t("E-mail")}>
            <input
              className="n-campo"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </Campo>
          <Campo
            rotulo={t("CPF")}
            dica={!novo && paciente?.cpf_hash ? t("Já informado. Preencha só para trocar.") : null}
          >
            <input
              className="n-campo"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
          </Campo>
        </div>

        {!origens.isError && listaDeOrigens.length > 0 && (
          <div data-testid="novo-paciente-origem">
            <p className="n-rotulo">{t("Como chegou à clínica")}</p>
            {atual.data?.automatica && origemId === null && (
              <p className="n-suave mb-2 text-xs">
                {t("Chegou pelo WhatsApp. Escolha outra origem se não foi isso.")}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {listaDeOrigens.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="n-chip"
                  aria-pressed={o.id === origemId}
                  onClick={() => setOrigemId(o.id === origemId ? null : o.id)}
                >
                  {t(o.nome)}
                </button>
              ))}
            </div>
            {pergunta && complemento !== "indicado_por" && (
              <div className="mt-3">
                <Campo rotulo={t(pergunta)}>
                  <input
                    className="n-campo"
                    value={detalhe}
                    onChange={(e) => setDetalhe(e.target.value)}
                    maxLength={200}
                    data-testid="novo-paciente-origem-detalhe"
                  />
                </Campo>
              </div>
            )}
            {complemento === "indicado_por" && (
              <div className="mt-3">
                <p className="n-rotulo">{t("Quem indicou")}</p>
                {indicador ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-[var(--n-papel)] p-3">
                    <Avatar nome={indicador.nome} tamanho={32} />
                    <span className="flex-1 font-semibold">{indicador.nome}</span>
                    <button
                      type="button"
                      className="n-botao n-botao-suave n-botao-pequeno"
                      onClick={() => setIndicador(null)}
                    >
                      {t("Trocar")}
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      className="n-campo"
                      placeholder={t("Nome ou telefone de quem indicou")}
                      value={buscaIndicador}
                      onChange={(e) => setBuscaIndicador(e.target.value)}
                      aria-label={t("Buscar quem indicou")}
                    />
                    {buscaIndicador.trim().length >= 2 &&
                      !candidatos.isFetching &&
                      (candidatos.data ?? []).length === 0 && (
                        <p className="n-suave mt-2 text-xs">
                          {t("Ninguém com esse nome. Busque pelo telefone com DDD.")}
                        </p>
                      )}
                    <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto">
                      {(candidatos.data ?? [])
                        .filter((c) => c.id !== paciente?.id)
                        .slice(0, 6)
                        .map((c) => {
                          const n = rotuloDoContato(c, t);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className="n-linha-clicavel items-center gap-3 px-2 py-2"
                              onClick={() => setIndicador({ id: c.id, nome: n })}
                            >
                              <Avatar nome={n} tamanho={28} />
                              <span className="flex-1 truncate text-sm font-semibold">{n}</span>
                              <span className="n-fraco text-xs">{c.phone_number}</span>
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <Campo rotulo={t("Etiquetas")} dica={t("Separe com vírgula, ex.: pilates, coluna")}>
          <input
            className="n-campo"
            value={etiquetas}
            onChange={(e) => setEtiquetas(e.target.value)}
            autoComplete="off"
          />
        </Campo>

        {problemas.length > 0 && nome.trim() !== "" && (
          <p className="text-sm font-semibold text-[var(--n-alerta)]" role="alert">
            {problemas[0]}
          </p>
        )}
        <button
          type="submit"
          className="n-botao n-botao-principal w-full"
          disabled={problemas.length > 0 || salvar.isPending}
          data-testid="novo-paciente-salvar"
        >
          {salvar.isPending
            ? t("Salvando…")
            : novo
              ? t("Cadastrar paciente")
              : t("Salvar alterações")}
        </button>
      </form>
    </Folha>
  );
}

function Campo({
  rotulo,
  dica,
  erro,
  children,
}: {
  rotulo: string;
  dica?: string | null;
  erro?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="n-rotulo !mb-0">{rotulo}</span>
      {children}
      {erro ? (
        <span className="text-xs font-semibold text-[var(--n-alerta)]">{erro}</span>
      ) : dica ? (
        <span className="n-fraco text-xs">{dica}</span>
      ) : null}
    </label>
  );
}
