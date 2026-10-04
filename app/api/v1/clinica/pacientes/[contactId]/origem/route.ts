/**
 * A ORIGEM DE UM PACIENTE (módulo clínica, migration 9005).
 *
 * GET → por onde o paciente chegou: a origem registrada pela recepção, com o detalhe
 *       (influenciador, anúncio, médico) e quem indicou; ou, sem registro, "WhatsApp" calculado
 *       quando o contato chegou por lá (`automatica: true`). Todo membro lê.
 * PUT { origem_id, detalhe?, indicado_por_contact_id? } → registra ou corrige. Recepção para
 *       cima (`agent`+). Instagram e encaminhamento pedem o detalhe; indicação pede o paciente que
 *       indicou, que precisa ser desta clínica e não o próprio paciente.
 *
 * A gravação é do SERVIDOR (client de serviço, organização do cookie em todo filtro): a RLS de
 * `clinica_pacientes_origem` não deixa ninguém gravar pela sessão.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDaOrigemDoPaciente } from "@/lib/clinica/origens";
import { origemDoPacienteSchema } from "@/lib/clinica/origens-schemas";
import {
  ModuloClinicaAusente,
  origemDoPaciente,
  origensDaClinica,
} from "@/lib/clinica/origens-servidor";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NAO_ENCONTRADO = "Paciente não encontrado nesta clínica.";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ contactId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "clinica_pacientes_origem" });
  if (!authz.ok) return authz.response;

  const { contactId } = await context.params;
  if (!z.string().uuid().safeParse(contactId).success) {
    return fail("not_found", NAO_ENCONTRADO, 404, { requestId });
  }
  try {
    const sessao = await createClient();
    const org = authz.org.orgId;
    const origens = await origensDaClinica(sessao, createAdminClient(), org);
    const origem = await origemDoPaciente(sessao, org, contactId, origens);
    if (!origem) return fail("not_found", NAO_ENCONTRADO, 404, { requestId });
    return ok(origem, { requestId });
  } catch (err) {
    if (err instanceof ModuloClinicaAusente) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ contactId: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "clinica_pacientes_origem" });
  if (!authz.ok) return authz.response;

  const { contactId } = await context.params;
  if (!z.string().uuid().safeParse(contactId).success) {
    return fail("not_found", NAO_ENCONTRADO, 404, { requestId });
  }
  const lido = origemDoPacienteSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const org = authz.org.orgId;
  const admin = createAdminClient();
  try {
    // O paciente é desta clínica? (pela sessão: quem não enxerga o contato não o altera)
    const sessao = await createClient();
    const { data: contato, error: erroContato } = await sessao
      .from("contacts")
      .select("id")
      .eq("organization_id", org)
      .eq("id", contactId)
      .maybeSingle();
    if (erroContato) return fail("internal_error", erroContato.message, 500, { requestId });
    if (!contato) return fail("not_found", NAO_ENCONTRADO, 404, { requestId });

    const origens = await origensDaClinica(sessao, admin, org);
    const origem = origens.find((o) => o.id === lido.data.origem_id);
    if (!origem || !origem.ativo) {
      return fail("validation_failed", "Escolha uma origem da lista da clínica.", 422, {
        requestId,
      });
    }

    const recusa = recusaDaOrigemDoPaciente(origem.tipo, lido.data, contactId);
    if (recusa) return fail("validation_failed", recusa, 422, { requestId });

    // Quem indicou só vale para indicação, e precisa ser paciente desta clínica.
    const indicadoPor = origem.tipo === "indicacao" ? lido.data.indicado_por_contact_id : null;
    if (indicadoPor) {
      const { data: indicou, error: erroIndicou } = await admin
        .from("contacts")
        .select("id")
        .eq("organization_id", org)
        .eq("id", indicadoPor)
        .maybeSingle();
      if (erroIndicou) return fail("internal_error", erroIndicou.message, 500, { requestId });
      if (!indicou) {
        return fail("validation_failed", "O paciente que indicou não é desta clínica.", 422, {
          requestId,
        });
      }
    }
    const detalhe = origem.tipo === "indicacao" ? null : lido.data.detalhe?.trim() || null;

    const { error } = await admin.from("clinica_pacientes_origem").upsert(
      {
        organization_id: org,
        contact_id: contactId,
        origem_id: origem.id,
        detalhe,
        indicado_por_contact_id: indicadoPor ?? null,
        registrado_por_user_id: authz.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,contact_id" },
    );
    if (error) {
      if (moduloClinicaNaoInstalado(error)) {
        return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
      }
      return fail("internal_error", error.message, 500, { requestId });
    }

    await audit({
      action: "clinica.paciente_origem_registrada",
      actorUserId: authz.user.id,
      organizationId: org,
      resourceType: "contact",
      resourceId: contactId,
      requestId,
      metadata: {
        origem_id: origem.id,
        origem: origem.nome,
        tipo: origem.tipo,
        com_detalhe: Boolean(detalhe),
        indicado_por_contact_id: indicadoPor ?? null,
      },
    });

    const atual = await origemDoPaciente(sessao, org, contactId, origens);
    return ok(atual, { requestId });
  } catch (err) {
    if (err instanceof ModuloClinicaAusente) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
