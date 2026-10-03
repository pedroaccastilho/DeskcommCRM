/**
 * O CATÁLOGO DE PACOTES DA CLÍNICA (módulo clínica, migration 9004).
 *
 * GET  → os pacotes que a clínica vende, ativos primeiro. Recepção para cima (`agent`+): o valor
 *        é financeiro, e "Somente leitura" não o vê (a RLS também não deixa).
 * POST { nome, modalidade, sessoes, validade_dias, valor_cents?, ativo? } → cadastra. Só o
 *        administrador. Sem `valor_cents`, o pacote fica sem preço e funciona igual: a clínica
 *        ainda não definiu os valores.
 *
 * CLIENT DE SESSÃO: a RLS de `clinica_produtos` já separa quem lê de quem escreve.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { produtoSchema } from "@/lib/clinica/pacotes-schemas";
import { COLUNAS_DO_PRODUTO } from "@/lib/clinica/pacotes-servidor";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "clinica_produtos" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_produtos")
    .select(COLUNAS_DO_PRODUTO)
    .eq("organization_id", authz.org.orgId)
    .order("ativo", { ascending: false })
    .order("nome", { ascending: true });
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_produtos" });
  if (!authz.ok) return authz.response;

  const lido = produtoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const { data, error } = await supabase
    .from("clinica_produtos")
    .insert({
      organization_id: org,
      ...lido.data,
      currency: await moedaDaOrganizacao(supabase, org),
    })
    .select(COLUNAS_DO_PRODUTO)
    .single();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    if (error.code === "23505") {
      return fail("conflict", "Já existe um pacote com esse nome no catálogo.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.produto_cadastrado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_produto",
    resourceId: data.id,
    requestId,
    metadata: {
      nome: data.nome,
      modalidade: data.modalidade,
      sessoes: data.sessoes,
      validade_dias: data.validade_dias,
      valor_cents: data.valor_cents,
    },
  });
  return ok(data, { requestId, status: 201 });
}
