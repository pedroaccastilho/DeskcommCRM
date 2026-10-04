/**
 * RELATÓRIO POR ORIGEM (módulo clínica, migration 9005).
 *
 * GET ?de=AAAA-MM-DD&ate=AAAA-MM-DD (horário de Brasília, `ate` inclusive; sem eles, o mês
 * corrente) → por origem: quantos pacientes NOVOS chegaram no período, quantos compraram pacote,
 * quantos pacotes e quanto somam, com o detalhe por baixo (qual influenciador, anúncio ou médico
 * trouxe quantos). Gerente para cima: tem valor vendido.
 *
 * A conta é de `fn_clinica_relatorio_origens`, que só o servidor executa, com a organização do
 * cookie.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import {
  consolidarRelatorio,
  periodoDoRelatorio,
  type LinhaDoRelatorioDeOrigens,
} from "@/lib/clinica/origens";
import { relatorioDeOrigensSchema } from "@/lib/clinica/origens-schemas";
import { ModuloClinicaAusente, origensDaClinica } from "@/lib/clinica/origens-servidor";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "clinica_relatorio_origens" });
  if (!authz.ok) return authz.response;

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

  const org = authz.org.orgId;
  const admin = createAdminClient();
  try {
    const origens = await origensDaClinica(await createClient(), admin, org);
    const { data, error } = await admin.rpc("fn_clinica_relatorio_origens", {
      p_org: org,
      p_de: periodo.inicio.toISOString(),
      p_ate: periodo.fim.toISOString(),
    });
    if (error) {
      if (moduloClinicaNaoInstalado(error)) {
        return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
      }
      return fail("internal_error", error.message, 500, { requestId });
    }
    const relatorio = consolidarRelatorio((data ?? []) as LinhaDoRelatorioDeOrigens[], origens);
    return ok({ periodo: { de: periodo.de, ate: periodo.ate }, ...relatorio }, { requestId });
  } catch (err) {
    if (err instanceof ModuloClinicaAusente) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
