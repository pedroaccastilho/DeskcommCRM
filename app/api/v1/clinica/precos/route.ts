/**
 * O PREÇO DA SESSÃO DE CADA TIPO DE AGENDAMENTO (módulo clínica, migration 9003).
 *
 * É a base da multa de cancelamento em cima da hora. Valor financeiro: só `admin` lê e altera,
 * pela rota e pela RLS de `clinica_precos` (pedido do Pedro, 02/10/2026). Quem cancela não
 * precisa ler o preço; o servidor o lê ao calcular a multa (`lib/clinica/regras-da-agenda.ts`).
 *
 * GET: os tipos ATIVOS da organização, com `valor_cents` (ou `null`, sem preço).
 * PUT { event_type_id, valor_cents | null }: grava ou, com `null`, apaga o preço.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { precoSchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "clinica_precos" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const org = authz.org.orgId;
  const [tipos, precos] = await Promise.all([
    supabase
      .from("calendar_event_types")
      .select("id, name")
      .eq("organization_id", org)
      .eq("is_active", true)
      .order("position"),
    supabase
      .from("clinica_precos")
      .select("event_type_id, valor_cents, currency")
      .eq("organization_id", org),
  ]);
  if (precos.error && moduloClinicaNaoInstalado(precos.error)) {
    return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
  }
  const erro = tipos.error ?? precos.error;
  if (erro) return fail("internal_error", erro.message, 500, { requestId });

  const porTipo = new Map((precos.data ?? []).map((p) => [p.event_type_id as string, p]));
  return ok(
    (tipos.data ?? []).map((t) => {
      const p = porTipo.get(t.id as string);
      return {
        event_type_id: t.id,
        nome: t.name,
        valor_cents: (p?.valor_cents as number | undefined) ?? null,
        currency: (p?.currency as string | undefined) ?? "BRL",
      };
    }),
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_precos" });
  if (!authz.ok) return authz.response;

  const lido = precoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const { event_type_id, valor_cents } = lido.data;

  const resultado =
    valor_cents === null
      ? await supabase
          .from("clinica_precos")
          .delete()
          .eq("organization_id", org)
          .eq("event_type_id", event_type_id)
      : await supabase.from("clinica_precos").upsert(
          {
            organization_id: org,
            event_type_id,
            valor_cents,
            updated_by_user_id: authz.user.id,
          },
          { onConflict: "organization_id,event_type_id" },
        );

  if (resultado.error) {
    if (moduloClinicaNaoInstalado(resultado.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    if (resultado.error.message?.includes("clinica_tipo_de_outra_organizacao")) {
      return fail("not_found", "Tipo de agendamento não encontrado nesta clínica.", 404, {
        requestId,
      });
    }
    return fail("internal_error", resultado.error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.preco_atualizado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "calendar_event_type",
    resourceId: event_type_id,
    requestId,
    metadata: { valor_cents },
  });

  return ok({ event_type_id, valor_cents }, { requestId });
}
