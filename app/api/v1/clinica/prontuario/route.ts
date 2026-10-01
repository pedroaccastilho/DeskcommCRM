/**
 * PRONTUÁRIO DO PACIENTE — ler a linha do tempo clínica e assinar um registro novo.
 *
 * ⚠️ CLIENT DE SESSÃO, sempre. Quem decide quem lê e quem assina é a RLS e os gatilhos da
 * migration 9001 (profissional ativo, nunca sessão de suporte, assinatura carimbada pelo banco,
 * registro imutável). Esta rota não usa o service_role em ponto nenhum: com ele, a régua inteira
 * ficaria de fora.
 *
 * Toda leitura que devolve registro grava uma linha em `prontuario_acessos` (quem abriu o
 * prontuário de quem). A gravação passa pela RLS: só profissional consegue, e é ele quem lê.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  MODULO_CLINICA_NAO_INSTALADO,
  falhaDoProntuario,
  moduloClinicaNaoInstalado,
} from "@/lib/clinica/api";
import { criarRegistroSchema } from "@/lib/clinica/schemas";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, contact_id, modalidade, tipo, appointment_id, adendo_de, conteudo, texto, autor_user_id, autor_nome, autor_registro, assinado_em";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "prontuario_registros" });
  if (!authz.ok) return authz.response;

  const contato = z.string().uuid().safeParse(new URL(req.url).searchParams.get("contact_id"));
  if (!contato.success) {
    return fail("validation_failed", "contact_id inválido", 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prontuario_registros")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .eq("contact_id", contato.data)
    .order("assinado_em", { ascending: false })
    .limit(500);

  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  // A trilha só ganha linha quando quem leu é profissional (a RLS recusa os outros, e para eles
  // a lista volta vazia de qualquer jeito). Falha na trilha não esconde o prontuário de quem
  // atende: vira alerta no log, não 500.
  const { error: erroDaTrilha } = await supabase
    .from("prontuario_acessos")
    .insert({ organization_id: authz.org.orgId, contact_id: contato.data, user_id: authz.user.id });
  if (erroDaTrilha && erroDaTrilha.code !== "42501") {
    logger.warn("prontuario_acesso_nao_registrado", { requestId, err: erroDaTrilha.message });
  }

  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("viewer", { requestId, resource: "prontuario_registros" });
  if (!authz.ok) return authz.response;

  const lido = criarRegistroSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  // autor_nome e autor_registro vão vazios de propósito: o gatilho os carimba a partir do
  // cadastro de quem está logado, e recusa se não houver cadastro.
  const { data, error } = await supabase
    .from("prontuario_registros")
    .insert({
      organization_id: authz.org.orgId,
      contact_id: lido.data.contact_id,
      modalidade: lido.data.modalidade,
      tipo: lido.data.tipo,
      appointment_id: lido.data.appointment_id ?? null,
      adendo_de: lido.data.adendo_de ?? null,
      conteudo: lido.data.conteudo,
      texto: lido.data.texto?.trim() || null,
      autor_user_id: authz.user.id,
      autor_nome: "",
      autor_registro: "",
    })
    .select(COLUNAS)
    .single();

  if (error) return falhaDoProntuario(error, requestId);

  // O conteúdo clínico NÃO vai para a auditoria: só o fato de que houve um registro.
  await audit({
    action: "prontuario.registro_assinado",
    resourceType: "prontuario_registro",
    resourceId: data.id,
    requestId,
    metadata: { contact_id: data.contact_id, modalidade: data.modalidade, tipo: data.tipo },
  });

  return ok(data, { requestId, status: 201 });
}
