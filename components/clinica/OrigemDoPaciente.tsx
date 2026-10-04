"use client";

/**
 * A origem do paciente na tela: o campo do cadastro e a linha da ficha (módulo clínica,
 * migration 9005). É o lado de TELA das rotas `/api/v1/clinica/origens` e
 * `/api/v1/clinica/pacientes/{id}/origem` e de `lib/clinica/origem-na-tela.ts`.
 *
 * A lista de origens é da clínica (Configurações › Regras da clínica); o tipo de cada uma diz o
 * que a recepção conta junto: o médico do encaminhamento, o influenciador ou anúncio do
 * Instagram, o paciente que indicou. Quem chega pelo WhatsApp já aparece como "WhatsApp
 * (automático)" até alguém corrigir. Todo membro vê a origem; mudar é da Recepção para cima.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClinicaEu } from "@/components/clinica/ProntuarioDoPaciente";
import { useContactList } from "@/hooks/contacts/useContactList";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { phoneForDisplay } from "@/lib/channels/phone-variants";
import {
  COMPLEMENTO_DO_TIPO,
  PERGUNTA_DO_DETALHE,
  type OrigemDaClinica,
} from "@/lib/clinica/origens";
import {
  corpoDaOrigem,
  escolhaInicial,
  recusaDaEscolha,
  type OrigemDoPaciente,
  type OrigemEscolhida,
} from "@/lib/clinica/origem-na-tela";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { randomId } from "@/lib/random-id";

const chaveDaOrigem = (contactId: string) => ["clinica", "origem", contactId] as const;

const SELECT =
  "flex h-10 w-full rounded-sm border border-border bg-bg px-3 text-sm text-text hover:border-border-strong focus-visible:outline-hidden focus-visible:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-soft";

export function useOrigensDaClinica(ativo: boolean) {
  return useQuery({
    queryKey: ["clinica", "origens"],
    enabled: ativo,
    staleTime: 60_000,
    retry: false,
    queryFn: async () =>
      (await apiClient.get<{ data: OrigemDaClinica[] }>("/api/v1/clinica/origens")).data,
  });
}

async function gravarOrigem(contactId: string, escolha: OrigemEscolhida): Promise<OrigemDoPaciente> {
  const resposta = await apiClient.put<{ data: OrigemDoPaciente }>(
    `/api/v1/clinica/pacientes/${contactId}/origem`,
    corpoDaOrigem(escolha),
    { idempotencyKey: randomId() },
  );
  return resposta.data;
}

/** A busca de quem indicou: a mesma lista de contatos do resto do CRM. */
function QuemIndicou({
  id,
  escolhido,
  onEscolher,
  excluir,
}: {
  id: string;
  escolhido: { id: string; nome: string } | null;
  onEscolher: (c: { id: string; nome: string } | null) => void;
  excluir?: string;
}) {
  const t = useT();
  const [termo, setTermo] = React.useState("");
  const [busca, setBusca] = React.useState("");
  React.useEffect(() => {
    const espera = setTimeout(() => setBusca(termo.trim()), 250);
    return () => clearTimeout(espera);
  }, [termo]);
  const lista = useContactList(busca ? { search: busca } : { limit: 6 });
  const achados = (lista.data?.pages.flatMap((p) => p.data) ?? [])
    .filter((c) => !c.is_anonymized && c.id !== excluir)
    .slice(0, 6);

  if (escolhido) {
    return (
      <div className="grid gap-2">
        <Label>{t("Quem indicou")}</Label>
        <div
          data-testid="quem-indicou-escolhido"
          className="flex items-center justify-between gap-2 rounded-sm border border-border px-3 py-2"
        >
          <span className="truncate text-sm text-text">{escolhido.nome}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEscolher(null)}>
            {t("Trocar")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("Quem indicou")}</Label>
      <Input
        id={id}
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder={t("Busque pelo nome ou telefone do paciente")}
        autoComplete="off"
      />
      <ul className="grid max-h-56 overflow-y-auto rounded-sm border border-border">
        {achados.length === 0 ? (
          <li className="px-3 py-2 text-sm text-text-muted">
            {lista.isLoading ? t("Buscando…") : t("Nenhum paciente encontrado.")}
          </li>
        ) : (
          achados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid="opcao-quem-indicou"
                onClick={() => {
                  onEscolher({ id: c.id, nome: rotuloDoContato(c, t) });
                  setTermo("");
                }}
                className="grid w-full gap-0.5 px-3 py-2 text-left hover:bg-surface-elevated"
              >
                <span className="text-sm text-text">{rotuloDoContato(c, t)}</span>
                {c.phone_number && (
                  <span className="text-xs text-text-muted">
                    {phoneForDisplay(c.phone_number)}
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** A origem e o complemento que ela pede. Controlado: quem usa guarda a escolha. */
export function CampoDeOrigem({
  origens,
  valor,
  onMudar,
  contactId,
  opcional = false,
}: {
  origens: OrigemDaClinica[];
  valor: OrigemEscolhida | null;
  onMudar: (v: OrigemEscolhida | null) => void;
  contactId?: string;
  opcional?: boolean;
}) {
  const t = useT();
  const prefixo = React.useId();
  // A origem desligada que o paciente já tem continua na lista, para a tela não mentir.
  const visiveis = origens.filter((o) => o.ativo || o.id === valor?.origem_id);
  const complemento = valor ? COMPLEMENTO_DO_TIPO[valor.tipo] : null;
  const pergunta = valor ? PERGUNTA_DO_DETALHE[valor.tipo] : null;

  return (
    <div className="grid gap-4" data-testid="campo-de-origem">
      <div className="grid gap-2">
        <Label htmlFor={`${prefixo}-origem`}>
          {opcional ? t("Como chegou à clínica (opcional)") : t("Como chegou à clínica")}
        </Label>
        <select
          id={`${prefixo}-origem`}
          className={SELECT}
          value={valor?.origem_id ?? ""}
          onChange={(e) => {
            const o = visiveis.find((x) => x.id === e.target.value);
            onMudar(
              o
                ? {
                    origem_id: o.id,
                    tipo: o.tipo,
                    detalhe: valor?.detalhe ?? "",
                    indicado_por: valor?.indicado_por ?? null,
                  }
                : null,
            );
          }}
        >
          <option value="">{t("Escolha a origem")}</option>
          {visiveis.map((o) => (
            <option key={o.id} value={o.id}>
              {t(o.nome)}
            </option>
          ))}
        </select>
      </div>
      {valor && complemento !== "indicado_por" && pergunta && (
        <div className="grid gap-2">
          <Label htmlFor={`${prefixo}-detalhe`}>{t(pergunta)}</Label>
          <Input
            id={`${prefixo}-detalhe`}
            value={valor.detalhe}
            maxLength={200}
            onChange={(e) => onMudar({ ...valor, detalhe: e.target.value })}
          />
        </div>
      )}
      {valor && complemento === "indicado_por" && (
        <QuemIndicou
          id={`${prefixo}-indicou`}
          escolhido={valor.indicado_por}
          onEscolher={(c) => onMudar({ ...valor, indicado_por: c })}
          excluir={contactId}
        />
      )}
    </div>
  );
}

/** A linha da origem no cabeçalho da ficha, com o "Indicado por" e a correção. */
export function OrigemNaFicha({
  contactId,
  ativo,
  podeMudar,
}: {
  contactId: string;
  ativo: boolean;
  podeMudar: boolean;
}) {
  const t = useT();
  const [editando, setEditando] = React.useState(false);
  const origem = useQuery({
    queryKey: chaveDaOrigem(contactId),
    enabled: ativo,
    staleTime: 30_000,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<{ data: OrigemDoPaciente }>(
          `/api/v1/clinica/pacientes/${contactId}/origem`,
        )
      ).data,
  });

  if (!ativo || !origem.data) return null;
  const o = origem.data;

  return (
    <div
      data-testid="origem-do-paciente"
      className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted"
    >
      {o.origem ? (
        <span data-testid="origem-texto">
          {t("Chegou por")}{" "}
          <span className="text-text">
            {o.automatica ? t("WhatsApp (automático)") : t(o.origem.nome)}
          </span>
          {o.detalhe ? `, ${o.detalhe}` : ""}.
        </span>
      ) : (
        <span data-testid="origem-texto">{t("Sem origem registrada.")}</span>
      )}
      {o.indicado_por && (
        <span data-testid="indicado-por">
          {t("Indicado por")}{" "}
          <Link
            href={`/app/contacts/${o.indicado_por.id}`}
            className="text-text underline underline-offset-2 hover:text-accent-600"
          >
            {o.indicado_por.nome}
          </Link>
          .
        </span>
      )}
      {podeMudar && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => setEditando(true)}
        >
          {o.origem && !o.automatica ? t("Corrigir origem") : t("Registrar origem")}
        </Button>
      )}
      {editando && (
        <DialogoDaOrigem
          contactId={contactId}
          atual={o}
          onFechar={() => setEditando(false)}
        />
      )}
    </div>
  );
}

function DialogoDaOrigem({
  contactId,
  atual,
  onFechar,
}: {
  contactId: string;
  atual: OrigemDoPaciente;
  onFechar: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const origens = useOrigensDaClinica(true);
  // Automática não é escolha de ninguém: o formulário abre vazio e a recepção confirma.
  const [escolha, setEscolha] = React.useState<OrigemEscolhida | null>(() =>
    atual.automatica ? null : escolhaInicial(atual),
  );
  const [erro, setErro] = React.useState<string | null>(null);
  const [salvando, setSalvando] = React.useState(false);

  async function salvar() {
    if (!escolha) {
      setErro(t("Escolha a origem."));
      return;
    }
    const recusa = recusaDaEscolha(escolha, contactId);
    if (recusa) {
      setErro(t(recusa));
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const gravada = await gravarOrigem(contactId, escolha);
      queryClient.setQueryData(chaveDaOrigem(contactId), gravada);
      toast.success(t("Origem registrada."));
      onFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : t("Não foi possível registrar a origem."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Origem do paciente")}</DialogTitle>
          <DialogDescription>
            {t("Por onde o paciente chegou à clínica. Entra no relatório de origens.")}
          </DialogDescription>
        </DialogHeader>
        {origens.data ? (
          <CampoDeOrigem
            origens={origens.data}
            valor={escolha}
            onMudar={(v) => {
              setEscolha(v);
              setErro(null);
            }}
            contactId={contactId}
          />
        ) : origens.error instanceof ApiError ? (
          <p className="text-sm text-error-fg">{origens.error.message}</p>
        ) : null}
        {erro && (
          <p role="alert" className="text-sm text-error-fg">
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onFechar} disabled={salvando}>
            {t("Cancelar")}
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando || !origens.data}>
            {salvando ? t("Salvando…") : t("Salvar origem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O campo de origem dentro do "Novo contato", sem o diálogo do núcleo saber de clínica: ele
 * recebe o campo pronto, pergunta se pode criar e manda gravar depois de ter o id. Sem o módulo,
 * o campo some e as duas perguntas respondem que está tudo certo.
 */
export function useOrigemNoCadastro({ aoMudar }: { aoMudar?: () => void } = {}) {
  const t = useT();
  const queryClient = useQueryClient();
  const eu = useClinicaEu();
  const instalado = eu.data?.instalado === true;
  const origens = useOrigensDaClinica(instalado);
  const [escolha, setEscolha] = React.useState<OrigemEscolhida | null>(null);

  const campo =
    instalado && origens.data ? (
      <CampoDeOrigem
        origens={origens.data}
        valor={escolha}
        onMudar={(v) => {
          setEscolha(v);
          aoMudar?.();
        }}
        opcional
      />
    ) : null;

  return {
    campo,
    /** Por que não dá para criar com esta origem, antes de criar o contato. */
    recusa(): string | null {
      if (!instalado || !escolha) return null;
      const r = recusaDaEscolha(escolha, "");
      return r ? t(r) : null;
    },
    /** Grava a origem do contato recém-criado. O contato já existe: a falha vira aviso. */
    async gravar(contactId: string): Promise<void> {
      if (!instalado || !escolha) return;
      try {
        const gravada = await gravarOrigem(contactId, escolha);
        queryClient.setQueryData(chaveDaOrigem(contactId), gravada);
      } catch (e) {
        toast.error(
          t("O contato foi criado, mas a origem não foi registrada: {motivo}").replace(
            "{motivo}",
            e instanceof ApiError ? e.message : t("tente de novo na ficha do paciente."),
          ),
        );
      }
    },
    limpar() {
      setEscolha(null);
    },
  };
}
