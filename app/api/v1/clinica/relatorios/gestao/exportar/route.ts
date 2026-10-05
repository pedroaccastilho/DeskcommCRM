/**
 * A EXPORTAÇÃO PARA A CONTABILIDADE (módulo clínica, migration 9009).
 *
 * GET ?tipo=resumo|sessoes|pacotes|multas&de=AAAA-MM-DD&ate=AAAA-MM-DD → um CSV no padrão
 * brasileiro (`;`, vírgula decimal, BOM, data dd/mm/aaaa em Brasília), para abrir no Excel ou
 * mandar ao financeiro externo. Administrador, Gerente e Financeiro (`recusaDoRelatorio`).
 *
 * As linhas vêm das funções `fn_clinica_exportar_*`, lidas em páginas de 1000 com `range`: o
 * PostgREST corta em 1000 linhas sem avisar, e uma planilha da contabilidade com linha faltando
 * parece certa. A planilha leva nome e telefone de paciente, então cada exportação é auditada
 * (`clinica.relatorio_exportado`).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import {
  csvBr,
  dataBr,
  dinheiroBr,
  horaBr,
  linhasDoResumo,
  modalidadeBr,
  nomeDoArquivo,
  situacaoDaSessao,
  TIPOS_DE_EXPORTACAO,
  type CelulaCsv,
  type RelatorioDaGestao,
} from "@/lib/clinica/gestao";
import { recusaDoRelatorio } from "@/lib/clinica/gestao-servidor";
import { periodoDoRelatorio } from "@/lib/clinica/origens";
import { relatorioDeOrigensSchema } from "@/lib/clinica/origens-schemas";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PAGINA = 1000;
/** Teto de linhas de uma planilha: um ano de uma clínica cabe com folga. */
const TETO = 50_000;

const tipoSchema = z.enum(TIPOS_DE_EXPORTACAO);

class Truncado extends Error {}

type Admin = ReturnType<typeof createAdminClient>;
type Erro = { code?: string; message: string };

async function todasAsLinhas<T>(
  admin: Admin,
  funcao:
    "fn_clinica_exportar_sessoes" | "fn_clinica_exportar_pacotes" | "fn_clinica_exportar_multas",
  args: { p_org: string; p_de: string; p_ate: string },
): Promise<{ linhas: T[] } | { erro: Erro }> {
  const linhas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await admin.rpc(funcao, args).range(desde, desde + PAGINA - 1);
    if (error) return { erro: error };
    const pagina = (data ?? []) as T[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) return { linhas };
    if (linhas.length >= TETO) throw new Truncado();
  }
}

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
  const authz = await requireRole("manager", { requestId, resource: "clinica_relatorio_gestao" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoRelatorio(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const params = req.nextUrl.searchParams;
  const tipo = tipoSchema.safeParse(params.get("tipo") ?? "resumo");
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
  let erro: Erro | null = null;
  try {
    switch (tipo.data) {
      case "resumo": {
        const { data, error } = await admin.rpc("fn_clinica_relatorio_gestao", args);
        if (error) {
          erro = error;
          break;
        }
        cabecalho = ["Indicador", "Quantidade", "Valor (R$)"];
        linhas = linhasDoResumo({
          periodo: { de: periodo.de, ate: periodo.ate },
          ...(data as Omit<RelatorioDaGestao, "periodo">),
        });
        break;
      }
      case "sessoes": {
        const r = await todasAsLinhas<
          Contato & {
            inicio: string;
            status: string;
            modalidade: string;
            tipo: string | null;
            profissional: string | null;
            do_pacote: boolean;
            preco_tabela_cents: number | null;
          }
        >(admin, "fn_clinica_exportar_sessoes", args);
        if ("erro" in r) {
          erro = r.erro;
          break;
        }
        cabecalho = [
          "Data",
          "Hora",
          "Paciente",
          "Profissional",
          "Modalidade",
          "Tipo",
          "Situação",
          "Cobrança",
          "Preço de tabela (R$)",
        ];
        linhas = r.linhas.map((l) => [
          dataBr(l.inicio),
          horaBr(l.inicio),
          paciente(l),
          l.profissional ?? "",
          modalidadeBr(l.modalidade),
          l.tipo ?? "",
          situacaoDaSessao(l.status),
          l.do_pacote ? "Pacote" : l.status === "completed" ? "Avulsa" : "",
          dinheiroBr(l.preco_tabela_cents),
        ]);
        break;
      }
      case "pacotes": {
        const r = await todasAsLinhas<
          Contato & {
            comprado_em: string;
            nome: string;
            modalidade: string;
            sessoes_total: number;
            valor_cents: number | null;
            currency: string;
            status: string;
            cancelado_em: string | null;
            reembolso_sugerido_cents: number | null;
          }
        >(admin, "fn_clinica_exportar_pacotes", args);
        if ("erro" in r) {
          erro = r.erro;
          break;
        }
        cabecalho = [
          "Data da venda",
          "Paciente",
          "Pacote",
          "Modalidade",
          "Sessões",
          "Valor (R$)",
          "Moeda",
          "Situação",
          "Cancelado em",
          "Reembolso sugerido (R$)",
        ];
        linhas = r.linhas.map((l) => [
          dataBr(l.comprado_em),
          paciente(l),
          l.nome,
          modalidadeBr(l.modalidade),
          l.sessoes_total,
          dinheiroBr(l.valor_cents),
          l.currency,
          l.status === "cancelado" ? "Cancelado" : "Ativo",
          dataBr(l.cancelado_em),
          dinheiroBr(l.reembolso_sugerido_cents),
        ]);
        break;
      }
      case "multas": {
        const r = await todasAsLinhas<
          Contato & {
            gerada_em: string;
            sessao_em: string | null;
            percentual: number;
            valor_cents: number | null;
            currency: string;
            status: string;
            isencao_motivo: string | null;
          }
        >(admin, "fn_clinica_exportar_multas", args);
        if ("erro" in r) {
          erro = r.erro;
          break;
        }
        cabecalho = [
          "Gerada em",
          "Data da sessão",
          "Paciente",
          "Percentual",
          "Valor (R$)",
          "Moeda",
          "Situação",
          "Motivo da isenção",
        ];
        linhas = r.linhas.map((l) => [
          dataBr(l.gerada_em),
          dataBr(l.sessao_em),
          paciente(l),
          `${l.percentual}%`,
          dinheiroBr(l.valor_cents),
          l.currency,
          l.status === "paga" ? "Paga" : l.status === "isenta" ? "Isenta" : "Pendente",
          l.isencao_motivo ?? "",
        ]);
        break;
      }
    }
  } catch (err) {
    if (err instanceof Truncado) {
      return fail(
        "validation_failed",
        "O período tem linhas demais para uma planilha. Escolha um período menor.",
        422,
        { requestId },
      );
    }
    throw err;
  }

  if (erro) {
    if (moduloClinicaNaoInstalado(erro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erro.message, 500, { requestId });
  }

  await audit({
    action: "clinica.relatorio_exportado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "clinica_relatorio_gestao",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { tipo: tipo.data, de: periodo.de, ate: periodo.ate, linhas: linhas!.length },
  });

  return new Response(csvBr(cabecalho!, linhas!), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(tipo.data, periodo.de, periodo.ate)}"`,
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
