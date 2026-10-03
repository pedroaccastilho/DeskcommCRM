/**
 * PACOTES DE SESSÕES DOS PACIENTES (módulo clínica, migration 9004).
 *
 * GET  [?contact_id=uuid][&situacao=ativo|esgotado|vencido|cancelado] → os pacotes, mais novos
 *      primeiro, com `sessoes_usadas`, `saldo`, `situacao` e `precisa_renovar`. Recepção para
 *      cima (`agent`+): o valor é financeiro.
 * POST { contact_id, produto_id? | modalidade, nome?, sessoes?, validade_dias?, valor_cents?,
 *      aceite_politica: true } → vende. O que não vier sai do catálogo (`produto_id`) ou das
 *      Regras da clínica (pacote padrão de 10 sessões e 60 dias). O aceite da política de
 *      cancelamento é obrigatório e fica gravado com os termos do momento. Aceita
 *      `Idempotency-Key: <uuid>` (um clique duplo não vende dois pacotes).
 *
 * ⚠️ CLIENT DE SERVIÇO na escrita: `clinica_pacotes` não tem policy de escrita para a sessão,
 * de propósito (ninguém fabrica saldo pela API do Supabase). A organização vem do cookie
 * validado e vai em todo filtro.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { chaveDaRequisicao, comIdempotencia } from "@/lib/api/idempotency";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { nomePadraoDoPacote, validoAte } from "@/lib/clinica/pacotes";
import { pacotesQuerySchema, venderPacoteSchema } from "@/lib/clinica/pacotes-schemas";
import {
  COLUNAS_DO_PACOTE,
  pacoteComSaldo,
  regrasDaOrganizacao,
  type LinhaDoPacote,
  type PacoteComSaldo,
} from "@/lib/clinica/pacotes-servidor";
import type { Modalidade } from "@/lib/clinica/vocabulario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Tag do endpoint no recibo de idempotência. */
const ENDPOINT = "/api/v1/clinica/pacotes";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "clinica_pacotes" });
  if (!authz.ok) return authz.response;

  const lido = pacotesQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "consulta inválida", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  let consulta = supabase
    .from("clinica_pacotes")
    .select(COLUNAS_DO_PACOTE)
    .eq("organization_id", org)
    .order("comprado_em", { ascending: false })
    .limit(500);
  if (lido.data.contact_id) consulta = consulta.eq("contact_id", lido.data.contact_id);

  const { data, error } = await consulta;
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const regras = await regrasDaOrganizacao(supabase, org);
  const pacotes = ((data ?? []) as unknown as LinhaDoPacote[]).map((l) =>
    pacoteComSaldo(l, regras.sessoes_restantes_aviso_renovacao),
  );
  const situacao = lido.data.situacao;
  return ok(situacao ? pacotes.filter((p) => p.situacao === situacao) : pacotes, { requestId });
}

/** Recusa de negócio da venda: sai como resposta, sem gravar recibo de idempotência. */
class Recusa extends Error {
  constructor(readonly resposta: Response) {
    super("recusa");
  }
}

interface ProdutoDoCatalogo {
  id: string;
  nome: string;
  modalidade: Modalidade;
  sessoes: number;
  validade_dias: number;
  valor_cents: number | string | null;
  currency: string;
  ativo: boolean;
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "clinica_pacotes" });
  if (!authz.ok) return authz.response;

  const lido = venderPacoteSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const chave = chaveDaRequisicao(req);
  if (chave !== null && !z.string().uuid().safeParse(chave).success) {
    return fail("validation_error", "Idempotency-Key deve ser UUID", 400, { requestId });
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const org = authz.org.orgId;
  const userId = authz.user.id;
  const corpo = lido.data;

  async function vender(): Promise<PacoteComSaldo> {
    const contato = await admin
      .from("contacts")
      .select("id")
      .eq("organization_id", org)
      .eq("id", corpo.contact_id)
      .maybeSingle();
    if (contato.error) throw contato.error;
    if (!contato.data) {
      throw new Recusa(
        fail("not_found", "Paciente não encontrado nesta clínica.", 404, { requestId }),
      );
    }

    let produto: ProdutoDoCatalogo | null = null;
    if (corpo.produto_id) {
      const lidoProduto = await admin
        .from("clinica_produtos")
        .select("id, nome, modalidade, sessoes, validade_dias, valor_cents, currency, ativo")
        .eq("organization_id", org)
        .eq("id", corpo.produto_id)
        .maybeSingle();
      if (lidoProduto.error) throw lidoProduto.error;
      produto = (lidoProduto.data as ProdutoDoCatalogo | null) ?? null;
      if (!produto) {
        throw new Recusa(
          fail("not_found", "Pacote do catálogo não encontrado.", 404, { requestId }),
        );
      }
      if (!produto.ativo) {
        throw new Recusa(
          fail("clinica_produto_fora_de_venda", "Este pacote saiu de venda no catálogo.", 409, {
            requestId,
          }),
        );
      }
      if (corpo.modalidade && corpo.modalidade !== produto.modalidade) {
        throw new Recusa(
          fail("validation_failed", "A modalidade não é a do pacote escolhido no catálogo.", 422, {
            requestId,
          }),
        );
      }
    }

    const regras = await regrasDaOrganizacao(admin, org);
    const modalidade = (produto?.modalidade ?? corpo.modalidade) as Modalidade;
    const sessoes = corpo.sessoes ?? produto?.sessoes ?? regras.pacote_sessoes_padrao;
    const validadeDias =
      corpo.validade_dias ?? produto?.validade_dias ?? regras.pacote_validade_dias;
    const valorDoCatalogo =
      produto?.valor_cents === null || produto?.valor_cents === undefined
        ? null
        : Number(produto.valor_cents);
    const valorCents = corpo.valor_cents !== undefined ? corpo.valor_cents : valorDoCatalogo;
    const agora = new Date();

    const { data, error } = await admin
      .from("clinica_pacotes")
      .insert({
        organization_id: org,
        contact_id: corpo.contact_id,
        produto_id: produto?.id ?? null,
        nome: corpo.nome ?? produto?.nome ?? nomePadraoDoPacote(sessoes, modalidade),
        modalidade,
        sessoes_total: sessoes,
        valor_cents: valorCents,
        currency: produto?.currency ?? (await moedaDaOrganizacao(admin, org)),
        comprado_em: agora.toISOString(),
        valido_ate: validoAte(agora, validadeDias).toISOString(),
        aceite_politica_em: agora.toISOString(),
        aceite_multa_pct: regras.multa_cancelamento_pct,
        aceite_antecedencia_horas: regras.antecedencia_cancelamento_horas,
        vendido_por_user_id: userId,
      })
      .select(COLUNAS_DO_PACOTE)
      .single();
    if (error) throw error;
    const pacote = pacoteComSaldo(
      data as unknown as LinhaDoPacote,
      regras.sessoes_restantes_aviso_renovacao,
    );

    await audit({
      action: "clinica.pacote_vendido",
      actorUserId: userId,
      organizationId: org,
      resourceType: "clinica_pacote",
      resourceId: pacote.id,
      requestId,
      metadata: {
        contact_id: pacote.contact_id,
        produto_id: pacote.produto_id,
        modalidade,
        sessoes,
        validade_dias: validadeDias,
        valor_cents: pacote.valor_cents,
        aceite_multa_pct: pacote.aceite_multa_pct,
        aceite_antecedencia_horas: pacote.aceite_antecedencia_horas,
      },
    });
    return pacote;
  }

  try {
    if (chave === null) return ok(await vender(), { requestId, status: 201 });

    const desfecho = await comIdempotencia({
      db: supabase,
      organizationId: org,
      endpoint: ENDPOINT,
      chave,
      corpo,
      executar: async () => ({ resposta: await vender(), status: 201 }),
    });
    if (desfecho.tipo === "conflito") {
      return fail(
        "idempotency_conflict",
        "Esta chave de idempotência já foi usada com outro conteúdo.",
        409,
        { requestId },
      );
    }
    if (desfecho.tipo === "em_curso") {
      return fail(
        "idempotency_in_progress",
        "A mesma venda ainda está em curso. Tente de novo em instantes.",
        409,
        { requestId },
      );
    }
    return ok(desfecho.resposta, { requestId, status: 201 });
  } catch (erro) {
    if (erro instanceof Recusa) return erro.resposta;
    if (moduloClinicaNaoInstalado(erro as { code?: string })) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", "Erro ao registrar a venda do pacote.", 500, { requestId });
  }
}
