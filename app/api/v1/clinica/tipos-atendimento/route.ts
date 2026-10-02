/**
 * MODALIDADE E VALOR DE CADA TIPO DE AGENDAMENTO (módulo clínica, migration 9002).
 *
 * É a etiqueta que faz um tipo de agendamento do núcleo virar "sessão da clínica": dá a cor da
 * modalidade na grade, liga a tolerância de atraso e a multa de cancelamento, e o valor da sessão
 * é a base da multa.
 *
 * GET: todos os tipos ATIVOS da organização, com `modalidade` e `valor_cents` (ou `null`).
 * PUT { event_type_id, modalidade | null, valor_cents? }: `manager`+. `modalidade: null` tira a
 * etiqueta.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { tipoAtendimentoSchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_tipos_atendimento" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const org = authz.org.orgId;
  const [tipos, etiquetas] = await Promise.all([
    supabase
      .from("calendar_event_types")
      .select("id, name, color, duration_minutes")
      .eq("organization_id", org)
      .eq("is_active", true)
      .order("position"),
    supabase
      .from("clinica_tipos_atendimento")
      .select("event_type_id, modalidade, valor_cents, currency")
      .eq("organization_id", org),
  ]);
  if (etiquetas.error && moduloClinicaNaoInstalado(etiquetas.error)) {
    return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
  }
  const erro = tipos.error ?? etiquetas.error;
  if (erro) return fail("internal_error", erro.message, 500, { requestId });

  const porTipo = new Map((etiquetas.data ?? []).map((e) => [e.event_type_id as string, e]));
  return ok(
    (tipos.data ?? []).map((t) => {
      const e = porTipo.get(t.id as string);
      return {
        event_type_id: t.id,
        nome: t.name,
        cor: t.color ?? null,
        duracao_minutos: t.duration_minutes,
        modalidade: e?.modalidade ?? null,
        valor_cents: e?.valor_cents ?? null,
        currency: e?.currency ?? "BRL",
      };
    }),
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", {
    requestId,
    resource: "clinica_tipos_atendimento",
  });
  if (!authz.ok) return authz.response;

  const lido = tipoAtendimentoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const { event_type_id, modalidade, valor_cents } = lido.data;

  const resultado =
    modalidade === null
      ? await supabase
          .from("clinica_tipos_atendimento")
          .delete()
          .eq("organization_id", org)
          .eq("event_type_id", event_type_id)
      : await supabase.from("clinica_tipos_atendimento").upsert(
          {
            organization_id: org,
            event_type_id,
            modalidade,
            ...(valor_cents !== undefined ? { valor_cents } : {}),
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
    action: "clinica.tipo_atendimento_atualizado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "calendar_event_type",
    resourceId: event_type_id,
    requestId,
    metadata: { modalidade, valor_cents: valor_cents ?? null },
  });

  return ok({ event_type_id, modalidade, valor_cents: valor_cents ?? null }, { requestId });
}
