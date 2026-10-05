/**
 * O RELATÓRIO DA GESTÃO (módulo clínica, migration 9009).
 *
 * GET ?de=AAAA-MM-DD&ate=AAAA-MM-DD (horário de Brasília, `ate` inclusive; sem eles, o mês
 * corrente) → sessões, pacotes, multas e pacientes novos do período, no total, por modalidade e
 * por profissional. Administrador, Gerente e Financeiro (`recusaDoRelatorio`): tem valor vendido.
 *
 * A ROTA NÃO SOMA NADA: quem conta é `fn_clinica_relatorio_gestao`, que só o servidor executa,
 * com a organização do cookie (somar aqui leria no máximo 1000 linhas, com cara de certo).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDoRelatorio } from "@/lib/clinica/gestao-servidor";
import { periodoDoRelatorio } from "@/lib/clinica/origens";
import { relatorioDeOrigensSchema } from "@/lib/clinica/origens-schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "clinica_relatorio_gestao" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoRelatorio(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const params = req.nextUrl.searchParams;
  const lido = relatorioDeOrigensSchema.safeParse({
    de: params.get("de") ?? undefined,
    ate: params.get("ate") ?? undefined,
  });
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "período inválido", 422, {
      requestId,
    });
  }
  const periodo = periodoDoRelatorio(lido.data.de, lido.data.ate);
  if (periodo.inicio >= periodo.fim) {
    return fail("validation_failed", "o início vem antes do fim", 422, { requestId });
  }

  const { data, error } = await createAdminClient().rpc("fn_clinica_relatorio_gestao", {
    p_org: authz.org.orgId,
    p_de: periodo.inicio.toISOString(),
    p_ate: periodo.fim.toISOString(),
  });
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(
    { periodo: { de: periodo.de, ate: periodo.ate }, ...(data as Record<string, unknown>) },
    { requestId },
  );
}
