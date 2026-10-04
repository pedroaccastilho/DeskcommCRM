"use client";

/**
 * A camada de dados da interface nova: as MESMAS rotas `/api/v1` da interface atual, lidas com
 * react-query. As chaves começam por "clinica" e "agenda", as mesmas da interface atual, para que
 * uma ação em qualquer tela repinte a outra.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { instanteDe } from "@/lib/agenda/fuso";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { PoliticaDaAgenda, SessaoDaGrade } from "@/lib/clinica/agenda";
import type { PacoteDaFicha } from "@/lib/clinica/pacotes-na-ficha";
import type { Modalidade, TipoDeRegistro } from "@/lib/clinica/vocabulario";
import type { CadastroDeProfissional } from "@/lib/novo/cargo";
import type { Role } from "@/lib/auth/types";
import type { OrigemDaClinica, TipoDeOrigem } from "@/lib/clinica/origens";
import type { Contact } from "@/lib/types/contacts";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

export interface Eu {
  instalado: boolean;
  profissional:
    | (CadastroDeProfissional & {
        id: string;
        nome_profissional: string;
        modalidades: Modalidade[];
      })
    | null;
  ve_acessos: boolean;
  /** Os perfis (migration 9008) de quem a tela mostra. */
  cargos?: string[];
  /** O papel de quem a tela mostra: o da pessoa vista, no "entrar como". */
  papel?: Role;
  /** O "entrar como" do administrador: de quem é a tela agora. */
  vendo_como?: { user_id: string; nome: string; email: string | null } | null;
}

export function useEu() {
  return useQuery({
    queryKey: ["clinica", "eu"],
    queryFn: async () => (await apiClient.get<{ data: Eu }>("/api/v1/clinica/eu")).data,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface ProfissionalDaGrade {
  user_id: string;
  nome: string;
  conselho: string;
  modalidades: Modalidade[];
}

export interface Grade {
  profissionais: ProfissionalDaGrade[];
  sessoes: SessaoDaGrade[];
  politica: PoliticaDaAgenda;
}

/** Os limites de um dia `AAAA-MM-DD` no fuso da clínica. */
export function limitesDoDia(dia: string, fuso: string): { de: string; ate: string } {
  const [ano, mes, d] = dia.split("-").map(Number) as [number, number, number];
  const amanha = new Date(Date.UTC(ano, mes - 1, d + 1, 12));
  return {
    de: instanteDe({ ano, mes, dia: d }, fuso).toISOString(),
    ate: instanteDe(
      { ano: amanha.getUTCFullYear(), mes: amanha.getUTCMonth() + 1, dia: amanha.getUTCDate() },
      fuso,
    ).toISOString(),
  };
}

/** Soma dias a `AAAA-MM-DD`, sem fuso (é data de parede). */
export function somarDias(dia: string, n: number): string {
  const [ano, mes, d] = dia.split("-").map(Number) as [number, number, number];
  const x = new Date(Date.UTC(ano, mes - 1, d + n, 12));
  return x.toISOString().slice(0, 10);
}

export function useGradeDoDia(dia: string, fuso: string) {
  const limites = React.useMemo(() => limitesDoDia(dia, fuso), [dia, fuso]);
  return useQuery({
    // "balcao" na chave: as janelas da interface atual invalidam ["clinica","balcao"].
    queryKey: ["clinica", "balcao", "novo", dia],
    queryFn: async () =>
      (
        await apiClient.get<{ data: Grade }>(
          `/api/v1/clinica/agenda?de=${encodeURIComponent(limites.de)}&ate=${encodeURIComponent(limites.ate)}&incluir_canceladas=1`,
        )
      ).data,
    refetchInterval: 60_000,
    retry: false,
  });
}

export interface TipoDeAtendimento {
  event_type_id: string;
  nome: string;
  duracao_minutos: number;
  preco_cents: number | null;
  modalidade: Modalidade | null;
}

export function useTiposDeAtendimento() {
  return useQuery({
    queryKey: ["clinica", "tipos-atendimento"],
    queryFn: async () =>
      (await apiClient.get<{ data: TipoDeAtendimento[] }>("/api/v1/clinica/tipos-atendimento"))
        .data,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface Pendencia {
  appointment_id: string;
  contact_id: string;
  paciente: string;
  titulo: string;
  inicio: string;
  atrasada: boolean;
}

export function usePendencias(habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "pendencias"],
    enabled: habilitado,
    queryFn: async () =>
      (await apiClient.get<{ data: unknown[] }>("/api/v1/clinica/pendencias")).data.map(
        normalizarPendencia,
      ),
    retry: false,
  });
}

/** O item como `GET /api/v1/clinica/pendencias` devolve. */
interface PendenciaDaRota {
  appointment_id: string;
  titulo: string;
  comeca: string;
  atrasada: boolean;
  contact_id: string;
  contato: { name: string | null; display_name: string | null } | null;
}

function normalizarPendencia(bruto: unknown): Pendencia {
  const p = bruto as PendenciaDaRota;
  return {
    appointment_id: p.appointment_id,
    contact_id: p.contact_id,
    paciente: nomeDoContato(p.contato) ?? p.titulo,
    titulo: p.titulo,
    inicio: p.comeca,
    atrasada: p.atrasada,
  };
}

export interface PacoteParaRenovar extends PacoteDaFicha {
  paciente: { name: string | null; display_name: string | null; phone_number: string | null };
}

export function usePacotesParaRenovar(habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "pacotes", "renovar"],
    enabled: habilitado,
    queryFn: async () =>
      (await apiClient.get<{ data: PacoteParaRenovar[] }>("/api/v1/clinica/pacotes/renovar")).data,
    retry: false,
  });
}

export interface MultaPendente {
  id: string;
  contact_id: string;
  valor_cents: number | null;
  currency: string;
  percentual: number;
  contacts: { name: string | null; display_name: string | null } | null;
}

export function useMultasPendentes(habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "multas", "pendente"],
    enabled: habilitado,
    queryFn: async () =>
      (await apiClient.get<{ data: MultaPendente[] }>("/api/v1/clinica/multas?status=pendente"))
        .data,
    retry: false,
  });
}

export function usePacotesDoPaciente(contactId: string) {
  return useQuery({
    queryKey: ["clinica", "pacotes", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: PacoteDaFicha[] }>(
          `/api/v1/clinica/pacotes?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
    retry: false,
  });
}

export interface RegistroDoProntuario {
  id: string;
  contact_id: string;
  modalidade: Modalidade;
  tipo: TipoDeRegistro;
  appointment_id: string | null;
  adendo_de: string | null;
  conteudo: Record<string, string | number>;
  texto: string | null;
  autor_user_id: string;
  autor_nome: string;
  autor_registro: string;
  assinado_em: string;
}

export function useProntuario(contactId: string, habilitado: boolean) {
  return useQuery({
    queryKey: ["clinica", "prontuario", contactId],
    enabled: habilitado,
    queryFn: async () =>
      (
        await apiClient.get<{ data: RegistroDoProntuario[] }>(
          `/api/v1/clinica/prontuario?contact_id=${encodeURIComponent(contactId)}`,
        )
      ).data,
    retry: false,
  });
}

export function usePaciente(contactId: string) {
  return useQuery({
    queryKey: ["contacts", contactId],
    queryFn: async () =>
      (await apiClient.get<{ data: Contact }>(`/api/v1/contacts/${encodeURIComponent(contactId)}`))
        .data,
    retry: false,
  });
}

export function useBuscaDePacientes(termo: string) {
  const busca = termo.trim();
  return useQuery({
    queryKey: ["contacts", "novo", busca],
    queryFn: async () => {
      const qs = new URLSearchParams({
        limit: "40",
        order_by: "last_activity_at",
        order_dir: "desc",
      });
      if (busca) qs.set("search", busca);
      return (await apiClient.get<{ data: Contact[] }>(`/api/v1/contacts?${qs.toString()}`)).data;
    },
    placeholderData: (anterior) => anterior,
    retry: false,
  });
}

/** As origens da clínica (WhatsApp, Instagram, indicação...). Sem o módulo clínica, 409. */
export function useOrigensDaClinica() {
  return useQuery({
    queryKey: ["clinica", "origens"],
    queryFn: async () =>
      (await apiClient.get<{ data: OrigemDaClinica[] }>("/api/v1/clinica/origens")).data,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface OrigemDoPacienteNaFicha {
  origem: { id: string; nome: string; tipo: TipoDeOrigem } | null;
  detalhe: string | null;
  indicado_por: { id: string; nome: string } | null;
  automatica: boolean;
}

/** Por onde o paciente chegou. `contactId` nulo = cadastro novo, nada a consultar. */
export function useOrigemDoPaciente(contactId: string | null) {
  return useQuery({
    queryKey: ["clinica", "origem-do-paciente", contactId],
    queryFn: async () =>
      (
        await apiClient.get<{ data: OrigemDoPacienteNaFicha }>(
          `/api/v1/clinica/pacientes/${encodeURIComponent(contactId!)}/origem`,
        )
      ).data,
    enabled: contactId !== null,
    retry: false,
  });
}

export interface SessaoListada {
  id: string;
  titulo: string;
  iniciaEm: string;
  situacao: string;
  donoId: string | null;
  tipo: { nome: string } | null;
}

/** As sessões de um paciente: as próximas e as dos últimos 60 dias. */
export function useSessoesDoPaciente(contactId: string) {
  return useQuery({
    queryKey: ["agenda", "paciente", "novo", contactId],
    queryFn: async () => {
      const agora = new Date();
      const de = new Date(agora.getTime() - 60 * 86_400_000);
      const listar = async (qs: URLSearchParams) =>
        (await apiClient.get<{ data: SessaoListada[] }>(`/api/v1/agenda/agendamentos?${qs}`))
          .data ?? [];
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
      return {
        futuras: futuras.filter((s) => new Date(s.iniciaEm).getTime() >= agora.getTime()),
        passadas: passadas.sort((a, b) => b.iniciaEm.localeCompare(a.iniciaEm)),
      };
    },
    retry: false,
  });
}

export interface FiltroDeHorarios {
  event_type_id: string;
  owner_user_id?: string;
  de: string;
  ate: string;
}

/**
 * Os horários livres, sem toast de erro: quando a agenda do profissional ainda não tem horário de
 * atendimento, a folha mostra a frase da rota no lugar dos horários, onde a pessoa está olhando.
 */
export function useHorariosLivresDaFolha(filtro: FiltroDeHorarios | null) {
  return useQuery({
    queryKey: ["agenda", "horarios-livres", "novo", filtro],
    enabled: filtro !== null,
    queryFn: async () => {
      const qs = new URLSearchParams({
        event_type_id: filtro!.event_type_id,
        de: filtro!.de,
        ate: filtro!.ate,
      });
      if (filtro!.owner_user_id) qs.set("owner_user_id", filtro!.owner_user_id);
      return (
        await apiClient.get<{ data: { slots: Array<{ inicio: string; fim: string }> } }>(
          `/api/v1/agenda/horarios-livres?${qs.toString()}`,
        )
      ).data;
    },
    retry: false,
  });
}

/** A frase de um erro de API para mostrar na tela. */
export function mensagemDoErro(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Não deu para consultar agora. Tente de novo.";
}

/** Depois de qualquer ação, as duas interfaces repintam. */
export function useRecarregar() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["clinica"] });
    void qc.invalidateQueries({ queryKey: ["agenda"] });
  }, [qc]);
}
