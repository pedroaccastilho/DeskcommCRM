"use client";
/**
 * Cadastro dos profissionais de saúde da clínica.
 *
 * Antes de o módulo ser instalado, a leitura devolve 409 `module_not_installed` e a tela mostra
 * o texto da rota (quem resolve é o administrador da instalação, não quem está aqui).
 * Ninguém é apagado: quem sai da clínica é desativado, porque o cadastro assina os registros
 * que a pessoa já fez.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import {
  CONSELHOS,
  MODALIDADES,
  ROTULO_DA_MODALIDADE,
  UFS,
  type Conselho,
  type Modalidade,
} from "@/lib/clinica/vocabulario";

export type Profissional = {
  id: string;
  user_id: string;
  nome_profissional: string;
  conselho: Conselho;
  registro_numero: string;
  registro_uf: string;
  modalidades: Modalidade[];
  ativo: boolean;
};

const CHAVE = ["clinica", "profissionais"];

export function ProfissionaisDaClinica({ podeEditar }: { podeEditar: boolean }) {
  const t = useT();
  const qc = useQueryClient();

  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () =>
      (await apiClient.get<{ data: Profissional[] }>("/api/v1/clinica/profissionais")).data,
    retry: false,
  });

  const alternar = useMutation({
    mutationFn: (p: Profissional) =>
      apiClient.patch(`/api/v1/clinica/profissionais/${p.id}`, { ativo: !p.ativo }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
    onError: showApiError,
  });

  if (lista.error instanceof ApiError && lista.error.code === "module_not_installed") {
    return (
      <p className="rounded-md border border-border p-3 text-sm text-text-muted" role="status">
        {lista.error.message}
      </p>
    );
  }
  if (lista.isError) {
    return (
      <p className="text-danger text-sm">{t("Não foi possível carregar os profissionais.")}</p>
    );
  }

  const cadastrados = lista.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {podeEditar ? (
        <FormularioDeProfissional
          jaCadastrados={cadastrados.map((p) => p.user_id)}
          aoCriar={() => void qc.invalidateQueries({ queryKey: CHAVE })}
        />
      ) : null}

      <section className="rounded-md border border-border p-3">
        <h2 className="mb-2 text-sm font-semibold">{t("Equipe clínica")}</h2>
        {lista.isLoading ? null : cadastrados.length === 0 ? (
          <p className="text-sm text-text-muted">{t("Nenhum profissional cadastrado ainda.")}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {cadastrados.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-testid={`profissional-${p.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.nome_profissional}</p>
                  <p className="text-xs text-text-muted">
                    {p.conselho}-{p.registro_uf} {p.registro_numero}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.modalidades.map((m) => (
                      <Badge key={m} variant="secondary">
                        {t(ROTULO_DA_MODALIDADE[m])}
                      </Badge>
                    ))}
                    {!p.ativo && <Badge variant="warning">{t("Desativado")}</Badge>}
                  </div>
                </div>
                {podeEditar ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={alternar.isPending}
                    onClick={() => alternar.mutate(p)}
                  >
                    {p.ativo ? t("Desativar") : t("Reativar")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FormularioDeProfissional({
  jaCadastrados,
  aoCriar,
}: {
  jaCadastrados: string[];
  aoCriar: () => void;
}) {
  const t = useT();
  const equipe = useTeamMembers();
  const [userId, setUserId] = useState("");
  const [nome, setNome] = useState("");
  const [conselho, setConselho] = useState<Conselho>("CREFITO");
  const [numero, setNumero] = useState("");
  const [uf, setUf] = useState("SP");
  const [modalidades, setModalidades] = useState<Modalidade[]>([]);

  const criar = useMutation({
    mutationFn: () =>
      apiClient.post("/api/v1/clinica/profissionais", {
        user_id: userId,
        nome_profissional: nome,
        conselho,
        registro_numero: numero,
        registro_uf: uf,
        modalidades,
      }),
    onSuccess: () => {
      setUserId("");
      setNome("");
      setNumero("");
      setModalidades([]);
      aoCriar();
    },
    onError: showApiError,
  });

  const disponiveis = (equipe.data?.data ?? []).filter(
    (m) => !m.revoked_at && m.accepted_at && !jaCadastrados.includes(m.user_id),
  );
  const pode =
    !criar.isPending &&
    userId !== "" &&
    nome.trim().length >= 2 &&
    numero.trim() !== "" &&
    modalidades.length > 0;

  const campo = "rounded-md border border-border bg-surface-elevated p-2 text-sm text-text";

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pode) criar.mutate();
      }}
    >
      <h2 className="text-sm font-semibold">{t("Cadastrar profissional")}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Pessoa da equipe")}
          <select
            value={userId}
            data-testid="profissional-usuario"
            onChange={(e) => {
              setUserId(e.target.value);
              const membro = disponiveis.find((m) => m.user_id === e.target.value);
              if (membro?.full_name && nome === "") setNome(membro.full_name);
            }}
            className={campo}
          >
            <option value="">{t("Escolha")}</option>
            {disponiveis.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.email ?? m.user_id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Nome como consta no conselho")}
          <input
            value={nome}
            data-testid="profissional-nome"
            onChange={(e) => setNome(e.target.value)}
            className={`${campo} w-64`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Conselho")}
          <select
            value={conselho}
            onChange={(e) => setConselho(e.target.value as Conselho)}
            className={campo}
          >
            {CONSELHOS.map((c) => (
              <option key={c} value={c}>
                {c === "outro" ? t("Outro") : c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          {t("Número do registro")}
          <input
            value={numero}
            data-testid="profissional-registro"
            onChange={(e) => setNumero(e.target.value)}
            className={`${campo} w-32`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          UF
          <select value={uf} onChange={(e) => setUf(e.target.value)} className={campo}>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="mb-1 text-xs text-text-muted">{t("Modalidades que atende")}</legend>
        {MODALIDADES.map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={modalidades.includes(m)}
              onChange={(e) =>
                setModalidades((atual) =>
                  e.target.checked ? [...atual, m] : atual.filter((x) => x !== m),
                )
              }
            />
            {t(ROTULO_DA_MODALIDADE[m])}
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" disabled={!pode} data-testid="cadastrar-profissional">
          {t("Cadastrar")}
        </Button>
      </div>
    </form>
  );
}
