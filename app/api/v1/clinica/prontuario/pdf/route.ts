/**
 * PRONTUÁRIO EM PDF — a cópia de todos os registros assinados de um paciente.
 *
 * ⚠️ CLIENT DE SESSÃO, como a leitura do prontuário: só profissional de saúde ativo lê
 * `prontuario_registros` (RLS da migration 9001), e sessão de suporte nunca lê. A rota recusa
 * com 403 quem não é profissional ANTES de montar o documento: para essa pessoa a RLS devolveria
 * zero registros, e um PDF "sem registros" mentiria sobre o paciente.
 *
 * Gerar a cópia é uma abertura do prontuário: grava uma linha em `prontuario_acessos`, igual à
 * leitura na tela, e uma linha de auditoria com o fato (nunca o conteúdo clínico).
 */
import { createHash, randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { renderProntuarioPdf, type RegistroParaPdf } from "@/lib/clinica/pdf-do-prontuario";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { logger } from "@/lib/logger";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SO_PROFISSIONAL =
  "Só profissional de saúde cadastrado e ativo na clínica exporta o prontuário.";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "prontuario_registros" });
  if (!authz.ok) return authz.response;
  if (authz.user.support) return fail("forbidden", SO_PROFISSIONAL, 403, { requestId });

  const contato = z.string().uuid().safeParse(new URL(req.url).searchParams.get("contact_id"));
  if (!contato.success) {
    return fail("validation_failed", "contact_id inválido", 422, { requestId });
  }

  const supabase = await createClient();
  const orgId = authz.org.orgId;

  const { data: eu, error: erroDoCadastro } = await supabase
    .from("clinica_profissionais")
    .select("nome_profissional, conselho, registro_numero, registro_uf, ativo")
    .eq("organization_id", orgId)
    .eq("user_id", authz.user.id)
    .maybeSingle();
  if (erroDoCadastro) {
    if (moduloClinicaNaoInstalado(erroDoCadastro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erroDoCadastro.message, 500, { requestId });
  }
  if (!eu?.ativo) return fail("forbidden", SO_PROFISSIONAL, 403, { requestId });

  const [paciente, organizacao, registros] = await Promise.all([
    supabase
      .from("contacts")
      .select("name, display_name, phone_number")
      .eq("organization_id", orgId)
      .eq("id", contato.data)
      .maybeSingle(),
    supabase.from("organizations").select("legal_name, display_name").eq("id", orgId).maybeSingle(),
    supabase
      .from("prontuario_registros")
      .select(
        "id, modalidade, tipo, appointment_id, adendo_de, conteudo, texto, autor_nome, autor_registro, assinado_em",
      )
      .eq("organization_id", orgId)
      .eq("contact_id", contato.data)
      .order("assinado_em", { ascending: true })
      .limit(2000),
  ]);
  if (paciente.error) return fail("internal_error", paciente.error.message, 500, { requestId });
  if (!paciente.data) return fail("not_found", "Paciente não encontrado.", 404, { requestId });
  if (registros.error) return fail("internal_error", registros.error.message, 500, { requestId });

  const org = organizacao.data as { legal_name: string | null; display_name: string | null } | null;
  const geradoEm = new Date();
  const buffer = await renderProntuarioPdf({
    clinica: org?.legal_name || org?.display_name || "—",
    paciente: {
      nome: nomeDoContato(paciente.data) ?? paciente.data.phone_number ?? "Paciente",
      telefone: paciente.data.phone_number,
    },
    geradoPor: `${eu.nome_profissional} · ${eu.conselho} ${eu.registro_numero}/${eu.registro_uf}`,
    geradoEm,
    registros: (registros.data ?? []) as unknown as RegistroParaPdf[],
  });
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const { error: erroDaTrilha } = await supabase
    .from("prontuario_acessos")
    .insert({ organization_id: orgId, contact_id: contato.data, user_id: authz.user.id });
  if (erroDaTrilha) {
    logger.warn("prontuario_acesso_nao_registrado", { requestId, err: erroDaTrilha.message });
  }

  await audit({
    action: "prontuario.exportado",
    resourceType: "contact",
    resourceId: contato.data,
    requestId,
    metadata: { registros: registros.data?.length ?? 0, sha256 },
  });

  const dia = geradoEm.toISOString().slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename=prontuario-${dia}.pdf`,
      "Cache-Control": "no-store",
      "X-Content-SHA256": sha256,
      "X-Request-Id": requestId,
    },
  });
}
