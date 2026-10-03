/**
 * PLANOS DE TRATAMENTO DO PACIENTE (módulo clínica, migration 9006).
 *
 * GET ?contact_id=uuid → o plano ativo de cada modalidade e as altas recentes, com "sessão 6 de
 * 10", a etapa (avaliado, em tratamento, alta) e o retorno de reavaliação marcado. Leitura de
 * `viewer`+: o plano é o pedaço NÃO clínico da avaliação, e a recepção precisa dele para marcar
 * as sessões. Quem cria o plano é o gatilho da avaliação assinada; ninguém escreve por aqui.
 *
 * O plano é lido pela sessão (RLS de membro). A contagem de sessões feitas e o horário do
 * retorno saem da agenda pelo service_role, filtrados pela organização de `requireRole`: a
 * contagem tem de ser a mesma para todo perfil, e o escopo de visualização da agenda de um
 * atendente esconderia as sessões dos colegas.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import {
  COLUNAS_DO_PLANO,
  etapaDoPlano,
  sessaoAtual,
  type LinhaDoPlano,
} from "@/lib/clinica/plano-de-tratamento";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Quantas altas antigas a ficha mostra, além dos planos ativos. */
const ALTAS_VISIVEIS = 3;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_planos_tratamento" });
  if (!authz.ok) return authz.response;

  const contato = z.string().uuid().safeParse(req.nextUrl.searchParams.get("contact_id"));
  if (!contato.success) {
    return fail("validation_failed", "contact_id inválido", 422, { requestId });
  }
  const org = authz.org.orgId;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_planos_tratamento")
    .select(COLUNAS_DO_PLANO)
    .eq("organization_id", org)
    .eq("contact_id", contato.data)
    .in("situacao", ["ativo", "alta"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const linhas = (data ?? []) as unknown as LinhaDoPlano[];
  const planos = [
    ...linhas.filter((p) => p.situacao === "ativo"),
    ...linhas.filter((p) => p.situacao === "alta").slice(0, ALTAS_VISIVEIS),
  ];
  if (planos.length === 0) return ok([], { requestId });

  const admin = createAdminClient();
  const modalidades = [...new Set(planos.map((p) => p.modalidade))];
  const { data: tipos } = await admin
    .from("clinica_tipos_atendimento")
    .select("event_type_id, modalidade")
    .eq("organization_id", org)
    .in("modalidade", modalidades);
  const tiposPorModalidade = new Map<string, string[]>();
  for (const t of (tipos ?? []) as Array<{ event_type_id: string; modalidade: string }>) {
    tiposPorModalidade.set(t.modalidade, [
      ...(tiposPorModalidade.get(t.modalidade) ?? []),
      t.event_type_id,
    ]);
  }

  const maisAntigo = planos.reduce(
    (m, p) => (p.created_at < m ? p.created_at : m),
    planos[0]!.created_at,
  );
  const { data: realizadas } = await admin
    .from("calendar_appointments")
    .select("id, event_type_id, starts_at")
    .eq("organization_id", org)
    .eq("contact_id", contato.data)
    .eq("status", "completed")
    .gte("starts_at", maisAntigo)
    .limit(1000);
  const feitas = (realizadas ?? []) as Array<{
    id: string;
    event_type_id: string | null;
    starts_at: string;
  }>;

  const idsDoRetorno = planos
    .map((p) => p.retorno_appointment_id)
    .filter((x): x is string => Boolean(x));
  const { data: retornos } = idsDoRetorno.length
    ? await admin
        .from("calendar_appointments")
        .select("id, starts_at, time_zone, status")
        .eq("organization_id", org)
        .in("id", idsDoRetorno)
    : { data: [] };
  const retornoPorId = new Map(
    (
      (retornos ?? []) as Array<{
        id: string;
        starts_at: string;
        time_zone: string | null;
        status: string;
      }>
    ).map((r) => [r.id, r]),
  );

  const resposta = planos.map((p) => {
    const tiposDaModalidade = new Set(tiposPorModalidade.get(p.modalidade) ?? []);
    const fim = p.encerrado_em ?? "9999-12-31";
    const sessoesFeitas = feitas.filter(
      (a) =>
        a.event_type_id !== null &&
        tiposDaModalidade.has(a.event_type_id) &&
        a.starts_at >= p.created_at &&
        a.starts_at <= fim &&
        a.id !== p.avaliacao_appointment_id &&
        a.id !== p.retorno_appointment_id,
    ).length;
    const retorno = p.retorno_appointment_id
      ? retornoPorId.get(p.retorno_appointment_id)
      : undefined;
    return {
      id: p.id,
      modalidade: p.modalidade,
      situacao: p.situacao,
      etapa: etapaDoPlano(p, sessoesFeitas),
      avaliador_user_id: p.avaliador_user_id,
      avaliador_nome: p.avaliador_nome,
      sessoes_previstas: p.sessoes_previstas,
      sessoes_feitas: sessoesFeitas,
      sessao_atual: sessaoAtual(sessoesFeitas),
      frequencia_semanal: p.frequencia_semanal,
      reavaliacao_em: p.reavaliacao_em,
      alta_motivo: p.alta_motivo,
      avaliado_em: p.created_at,
      encerrado_em: p.encerrado_em,
      retorno: {
        situacao: p.retorno_situacao,
        aviso: p.retorno_aviso,
        appointment_id: p.retorno_appointment_id,
        inicio: retorno && retorno.status !== "cancelled" ? retorno.starts_at : null,
        fuso: retorno?.time_zone ?? null,
        cancelado: retorno?.status === "cancelled",
      },
    };
  });

  return ok(resposta, { requestId });
}
