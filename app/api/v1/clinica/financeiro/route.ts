/**
 * O PAINEL FINANCEIRO (módulo clínica, migration 9012).
 *
 * GET ?de=AAAA-MM-DD&ate=AAAA-MM-DD → `{ periodo, resumo, entradas, a_receber, previsao, saidas,
 * cortado }`: o que entrou (pagamentos registrados), o que saiu (despesas), o que ainda falta
 * cobrar no período e o que a agenda diz que vai entrar (sessões marcadas daqui até o fim dele). Sem datas, o mês corrente. Administrador, Gerente e Financeiro (`recusaDoRelatorio`).
 *
 * As somas são do banco (`fn_clinica_financeiro_resumo`), nunca das listas: as listas param no
 * teto da tela e a soma não pode parar junto. Quem precisa de tudo baixa a planilha
 * (`/api/v1/clinica/financeiro/exportar`).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import type { PainelFinanceiro, ResumoFinanceiro } from "@/lib/clinica/financeiro";
import {
  lerAReceber,
  lerEntradas,
  lerPrevisao,
  lerSaidas,
} from "@/lib/clinica/financeiro-servidor";
import { recusaDoRelatorio } from "@/lib/clinica/gestao-servidor";
import { periodoDoRelatorio } from "@/lib/clinica/origens";
import { relatorioDeOrigensSchema } from "@/lib/clinica/origens-schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Linhas de cada lista na tela. */
const TETO_DA_TELA = 500;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "clinica_financeiro" });
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

  const admin = createAdminClient();
  const args = {
    p_org: authz.org.orgId,
    p_de: periodo.inicio.toISOString(),
    p_ate: periodo.fim.toISOString(),
  };
  const [resumo, entradas, aReceber, previsao, saidas] = await Promise.all([
    admin.rpc("fn_clinica_financeiro_resumo", args),
    lerEntradas(admin, args, TETO_DA_TELA),
    lerAReceber(admin, args, TETO_DA_TELA),
    lerPrevisao(admin, args, TETO_DA_TELA),
    lerSaidas(admin, args, TETO_DA_TELA),
  ]);

  const erro =
    resumo.error ??
    ("erro" in entradas ? entradas.erro : null) ??
    ("erro" in aReceber ? aReceber.erro : null) ??
    ("erro" in previsao ? previsao.erro : null) ??
    ("erro" in saidas ? saidas.erro : null);
  if (erro) {
    if (moduloClinicaNaoInstalado(erro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erro.message, 500, { requestId });
  }
  if ("erro" in entradas || "erro" in aReceber || "erro" in previsao || "erro" in saidas) {
    return fail("internal_error", "leitura incompleta", 500, { requestId });
  }

  const painel: PainelFinanceiro = {
    periodo: { de: periodo.de, ate: periodo.ate },
    resumo: resumo.data as ResumoFinanceiro,
    entradas: entradas.linhas,
    a_receber: aReceber.linhas,
    previsao: previsao.linhas,
    saidas: saidas.linhas,
    cortado: {
      entradas: entradas.cortado,
      a_receber: aReceber.cortado,
      previsao: previsao.cortado,
      saidas: saidas.cortado,
    },
  };
  return ok(painel, { requestId });
}
