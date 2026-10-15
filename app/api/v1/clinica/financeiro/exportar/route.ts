/**
 * A PLANILHA DO PAINEL FINANCEIRO (módulo clínica, migration 9012).
 *
 * GET ?tipo=entradas|saidas|a_receber|previsao&de=AAAA-MM-DD&ate=AAAA-MM-DD → um CSV no padrão brasileiro
 * (`;`, vírgula decimal, BOM, data dd/mm/aaaa em Brasília), igual às planilhas do relatório da
 * gestão. Administrador, Gerente e Financeiro (`recusaDoRelatorio`).
 *
 * Lê tudo do período em páginas de 1000 (o PostgREST corta em 1000 sem avisar), com teto de
 * 50 mil linhas. Entradas e "a receber" levam nome e telefone de paciente, então toda exportação
 * é auditada (`clinica.relatorio_exportado`, com `painel: "financeiro"`).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import {
  ROTULO_DA_CATEGORIA,
  ROTULO_DA_FORMA_DE_SAIDA,
  ROTULO_DO_TIPO,
  TIPOS_DE_EXPORTACAO_FINANCEIRA,
  nomeDoArquivoFinanceiro,
} from "@/lib/clinica/financeiro";
import {
  lerAReceber,
  lerEntradas,
  lerPrevisao,
  lerSaidas,
} from "@/lib/clinica/financeiro-servidor";
import { csvBr, dataBr, dinheiroBr, type CelulaCsv } from "@/lib/clinica/gestao";
import { recusaDoRelatorio } from "@/lib/clinica/gestao-servidor";
import { periodoDoRelatorio } from "@/lib/clinica/origens";
import { relatorioDeOrigensSchema } from "@/lib/clinica/origens-schemas";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto de linhas de uma planilha: um ano de uma clínica cabe com folga. */
const TETO = 50_000;

const tipoSchema = z.enum(TIPOS_DE_EXPORTACAO_FINANCEIRA);

interface Contato {
  contato_name: string | null;
  contato_display_name: string | null;
  contato_phone: string | null;
}

const paciente = (l: Contato) =>
  rotuloDoContato({
    name: l.contato_name,
    display_name: l.contato_display_name,
    phone_number: l.contato_phone,
  });

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "clinica_financeiro" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoRelatorio(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const params = req.nextUrl.searchParams;
  const tipo = tipoSchema.safeParse(params.get("tipo") ?? "entradas");
  if (!tipo.success) {
    return fail("validation_failed", "tipo de exportação inválido", 422, { requestId });
  }
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

  let cabecalho: string[];
  let linhas: CelulaCsv[][];
  let cortado: boolean;
  let erro: { code?: string; message: string } | null = null;
  switch (tipo.data) {
    case "entradas": {
      const r = await lerEntradas(admin, args, TETO);
      if ("erro" in r) {
        erro = r.erro;
        break;
      }
      cortado = r.cortado;
      cabecalho = [
        "Pago em",
        "Paciente",
        "O que",
        "Descrição",
        "Referente a",
        "Forma",
        "Valor (R$)",
        "Moeda",
      ];
      linhas = r.linhas.map((l) => [
        dataBr(l.pago_em),
        paciente(l),
        ROTULO_DO_TIPO[l.tipo] ?? l.tipo,
        l.descricao ?? "",
        dataBr(l.referente_em),
        ROTULO_DA_FORMA_DE_SAIDA[l.forma] ?? l.forma,
        dinheiroBr(l.valor_cents),
        l.currency,
      ]);
      break;
    }
    case "a_receber": {
      const r = await lerAReceber(admin, args, TETO);
      if ("erro" in r) {
        erro = r.erro;
        break;
      }
      cortado = r.cortado;
      cabecalho = ["Desde", "Paciente", "O que", "Descrição", "Valor (R$)", "Moeda"];
      linhas = r.linhas.map((l) => [
        dataBr(l.desde),
        paciente(l),
        ROTULO_DO_TIPO[l.tipo] ?? l.tipo,
        l.descricao ?? "",
        dinheiroBr(l.valor_cents),
        l.currency,
      ]);
      break;
    }
    case "previsao": {
      const r = await lerPrevisao(admin, args, TETO);
      if ("erro" in r) {
        erro = r.erro;
        break;
      }
      cortado = r.cortado;
      cabecalho = [
        "Marcado para",
        "Paciente",
        "Atendimento",
        "Pago por",
        "Valor previsto (R$)",
        "Moeda",
      ];
      linhas = r.linhas.map((l) => [
        dataBr(l.starts_at),
        paciente(l),
        l.descricao ?? "",
        l.coberta_por_pacote ? "Pacote" : "Avulsa",
        l.coberta_por_pacote ? "" : dinheiroBr(l.valor_cents),
        l.currency,
      ]);
      break;
    }
    case "saidas": {
      const r = await lerSaidas(admin, args, TETO);
      if ("erro" in r) {
        erro = r.erro;
        break;
      }
      cortado = r.cortado;
      cabecalho = ["Pago em", "Descrição", "Categoria", "Forma", "Valor (R$)", "Moeda"];
      linhas = r.linhas.map((l) => [
        dataBr(l.pago_em),
        l.descricao,
        ROTULO_DA_CATEGORIA[l.categoria] ?? l.categoria,
        ROTULO_DA_FORMA_DE_SAIDA[l.forma] ?? l.forma,
        dinheiroBr(l.valor_cents),
        l.currency,
      ]);
      break;
    }
  }

  if (erro) {
    if (moduloClinicaNaoInstalado(erro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erro.message, 500, { requestId });
  }
  if (cortado!) {
    return fail(
      "validation_failed",
      "O período tem linhas demais para uma planilha. Escolha um período menor.",
      422,
      { requestId },
    );
  }

  await audit({
    action: "clinica.relatorio_exportado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "clinica_financeiro",
    resourceId: authz.org.orgId,
    requestId,
    metadata: {
      painel: "financeiro",
      tipo: tipo.data,
      de: periodo.de,
      ate: periodo.ate,
      linhas: linhas!.length,
    },
  });

  return new Response(csvBr(cabecalho!, linhas!), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivoFinanceiro(tipo.data, periodo.de, periodo.ate)}"`,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
