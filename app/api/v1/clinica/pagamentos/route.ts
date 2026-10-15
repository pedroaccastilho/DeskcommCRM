/**
 * PAGAMENTOS REGISTRADOS (módulo clínica, migration 9011).
 *
 * GET ?contact_id=uuid → `{ pagamentos, sessoes_em_pacote }`: os pagamentos do paciente (pacote,
 * sessão avulsa e multa) e as sessões dele que gastaram um pacote, para a tela dizer "pago" ou
 * "a pagar" em cada coisa. Leitura de `agent`+ (o valor é financeiro).
 *
 * POST { pacote_id | appointment_id | multa_id, forma, valor_cents? } → registra que o paciente
 * pagou aquela coisa, e como. Registro à mão: não fala com maquininha nem banco. De
 * Administrador, Gerente, Recepção e Financeiro (`lib/clinica/pagamentos.ts`). Sem `valor_cents`,
 * vale o valor da coisa (o do pacote, o preço do tipo da sessão, o da multa). A multa paga passa a
 * `status = 'paga'`; multa isenta não se paga (409). Pagar de novo a mesma coisa é 409.
 *
 * ⚠️ CLIENT DE SERVIÇO na escrita: `clinica_pagamentos` e `clinica_multas` não têm policy de
 * escrita para a sessão. A organização vem do cookie validado e vai em todo filtro; o paciente sai
 * da coisa paga, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDoPagamento } from "@/lib/clinica/gestao-servidor";
import { pagamentosQuerySchema, registrarPagamentoSchema } from "@/lib/clinica/pagamentos";
import { precoDoTipo, tipoDaClinica } from "@/lib/clinica/regras-da-agenda";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { moedaDaOrganizacao } from "@/lib/catalogo/moeda-da-org";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, contact_id, pacote_id, appointment_id, multa_id, forma, valor_cents, currency, pago_em";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "clinica_pagamentos" });
  if (!authz.ok) return authz.response;

  const lido = pagamentosQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "consulta inválida", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const [pagamentos, consumos] = await Promise.all([
    supabase
      .from("clinica_pagamentos")
      .select(COLUNAS)
      .eq("organization_id", org)
      .eq("contact_id", lido.data.contact_id)
      .order("pago_em", { ascending: false })
      .limit(500),
    supabase
      .from("clinica_pacote_consumos")
      .select("appointment_id, clinica_pacotes!inner(contact_id)")
      .eq("organization_id", org)
      .eq("clinica_pacotes.contact_id", lido.data.contact_id)
      .not("appointment_id", "is", null)
      .limit(1000),
  ]);
  for (const r of [pagamentos, consumos]) {
    if (r.error) {
      if (moduloClinicaNaoInstalado(r.error)) {
        return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
      }
      return fail("internal_error", r.error.message, 500, { requestId });
    }
  }

  return ok(
    {
      pagamentos: pagamentos.data ?? [],
      sessoes_em_pacote: (consumos.data ?? []).map(
        (c) => (c as { appointment_id: string }).appointment_id,
      ),
    },
    { requestId },
  );
}

interface Alvo {
  contact_id: string;
  valor_cents: number | null;
  currency: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "clinica_pagamentos" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDoPagamento(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const lido = registrarPagamentoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }
  const corpo = lido.data;
  const org = authz.org.orgId;
  const admin = createAdminClient();

  // ── o que está sendo pago, sempre desta organização ──────────────────────
  let alvo: Alvo | null = null;
  try {
    if (corpo.pacote_id) {
      const { data, error } = await admin
        .from("clinica_pacotes")
        .select("contact_id, valor_cents, currency")
        .eq("organization_id", org)
        .eq("id", corpo.pacote_id)
        .maybeSingle();
      if (error) throw error;
      if (data)
        alvo = {
          ...data,
          valor_cents: data.valor_cents === null ? null : Number(data.valor_cents),
        };
    } else if (corpo.multa_id) {
      const { data, error } = await admin
        .from("clinica_multas")
        .select("contact_id, valor_cents, currency, status")
        .eq("organization_id", org)
        .eq("id", corpo.multa_id)
        .maybeSingle();
      if (error) throw error;
      if (data?.status === "isenta") {
        return fail(
          "conflict",
          "Esta multa está isenta: o paciente não paga. Volte a cobrar antes de registrar o pagamento.",
          409,
          { requestId },
        );
      }
      if (data) alvo = data;
    } else if (corpo.appointment_id) {
      const { data, error } = await admin
        .from("calendar_appointments")
        .select("contact_id, event_type_id, status")
        .eq("organization_id", org)
        .eq("id", corpo.appointment_id)
        .maybeSingle();
      if (error) throw error;
      if (data?.contact_id && data.event_type_id) {
        const daClinica = await tipoDaClinica(admin, org, data.event_type_id);
        if (!daClinica) {
          return fail("validation_failed", "Só sessão da clínica tem pagamento aqui.", 422, {
            requestId,
          });
        }
        if (data.status === "cancelled") {
          return fail(
            "validation_failed",
            "Sessão cancelada não se paga; o que se cobra é a multa.",
            422,
            { requestId },
          );
        }
        const preco = await precoDoTipo(admin, org, data.event_type_id);
        alvo = {
          contact_id: data.contact_id,
          valor_cents: preco?.valor_cents ?? null,
          currency: preco?.currency ?? (await moedaDaOrganizacao(admin, org)),
        };
      }
    }
  } catch (err) {
    if (moduloClinicaNaoInstalado(err as { code?: string })) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message ?? String(err), 500, { requestId });
  }
  if (!alvo) {
    return fail("not_found", "Não achei o que foi pago nesta clínica.", 404, { requestId });
  }

  const valor = corpo.valor_cents !== undefined ? corpo.valor_cents : alvo.valor_cents;
  const { data: pagamento, error } = await admin
    .from("clinica_pagamentos")
    .insert({
      organization_id: org,
      contact_id: alvo.contact_id,
      pacote_id: corpo.pacote_id ?? null,
      appointment_id: corpo.appointment_id ?? null,
      multa_id: corpo.multa_id ?? null,
      forma: corpo.forma,
      valor_cents: valor,
      currency: alvo.currency,
      registrado_por_user_id: authz.user.id,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("conflict", "Este pagamento já foi registrado.", 409, { requestId });
    }
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  if (corpo.multa_id) {
    const marcada = await admin
      .from("clinica_multas")
      .update({ status: "paga", updated_at: new Date().toISOString() })
      .eq("organization_id", org)
      .eq("id", corpo.multa_id)
      .eq("status", "pendente");
    if (marcada.error) return fail("internal_error", marcada.error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.pagamento_registrado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "clinica_pagamento",
    resourceId: pagamento.id,
    requestId,
    metadata: {
      contact_id: alvo.contact_id,
      pacote_id: corpo.pacote_id ?? null,
      appointment_id: corpo.appointment_id ?? null,
      multa_id: corpo.multa_id ?? null,
      forma: corpo.forma,
      valor_cents: valor,
    },
  });

  return ok(pagamento, { requestId, status: 201 });
}
