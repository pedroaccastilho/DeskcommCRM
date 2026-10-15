/**
 * COBRAR MULTA PELA FALTA (módulo clínica, migration 9011). Pedido do Pedro (2026-10-15): "indicar
 * quando o aluno faltou, se iremos cobrar a multa ou não".
 *
 * POST {} → lança a multa de uma sessão já registrada como falta (`no_show`). A falta continua
 * sem multa automática: quem decide cobrar é Administrador, Gerente ou Recepção
 * (`lib/clinica/multas.ts`), na hora de marcar "Faltou" ou depois, pela folha da sessão. O valor
 * segue a política da multa de cancelamento (`multaDaFalta`, `lib/clinica/agenda.ts`): o
 * percentual sobre o valor da sessão no pacote, ou o preço do tipo. A multa nasce `pendente`
 * (a cobrar), com `origem = 'falta'`, e daí em diante é uma multa como as outras (isentar, voltar a
 * cobrar, registrar o pagamento).
 *
 * Uma multa por sessão: pedir de novo é 409. Política com 0% é 422.
 *
 * ⚠️ CLIENT DE SERVIÇO: `clinica_multas` não tem policy de escrita para a sessão. A organização
 * vem do cookie validado e vai em todo filtro; o paciente sai da sessão, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { multaDaFalta } from "@/lib/clinica/agenda";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { recusaDaMulta } from "@/lib/clinica/gestao-servidor";
import { valorDaSessaoPeloPacote } from "@/lib/clinica/pacotes-servidor";
import { politicaDaOrganizacao, precoDoTipo, tipoDaClinica } from "@/lib/clinica/regras-da-agenda";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUNAS_DA_MULTA = "id, percentual, valor_cents, currency, status, origem";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "clinica_multas" });
  if (!authz.ok) return authz.response;
  const recusa = await recusaDaMulta(authz.org.orgId, authz.user.id, authz.org.role, requestId);
  if (recusa) return recusa;

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Sessão não encontrada.", 404, { requestId });
  }

  const admin = createAdminClient();
  const org = authz.org.orgId;
  try {
    const { data: sessao, error } = await admin
      .from("calendar_appointments")
      .select("id, contact_id, event_type_id, status, starts_at")
      .eq("organization_id", org)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!sessao) return fail("not_found", "Sessão não encontrada.", 404, { requestId });
    if (sessao.status !== "no_show") {
      return fail(
        "validation_failed",
        "A multa da falta só vale para sessão registrada como falta.",
        422,
        { requestId },
      );
    }
    const tipo = await tipoDaClinica(admin, org, sessao.event_type_id);
    if (!tipo || !sessao.contact_id || !sessao.event_type_id) {
      return fail("validation_failed", "Só sessão da clínica, com paciente, tem multa.", 422, {
        requestId,
      });
    }

    const inicio = new Date(sessao.starts_at);
    const politica = await politicaDaOrganizacao(admin, org);
    const preco =
      (await valorDaSessaoPeloPacote(admin, org, sessao.contact_id, tipo.modalidade, inicio)) ??
      (await precoDoTipo(admin, org, sessao.event_type_id));
    const multa = multaDaFalta({
      inicio,
      registradaEm: new Date(),
      politica,
      valorDaSessaoCents: preco?.valor_cents ?? null,
    });
    if (!multa) {
      return fail(
        "validation_failed",
        "A multa está em 0% nas Regras da clínica: não há o que cobrar.",
        422,
        { requestId },
      );
    }

    const { data, error: erroDoInsert } = await admin
      .from("clinica_multas")
      .insert({
        organization_id: org,
        appointment_id: id,
        contact_id: sessao.contact_id,
        percentual: multa.percentual,
        antecedencia_horas: multa.antecedencia_horas,
        valor_cents: multa.valor_cents,
        currency: preco?.currency ?? "BRL",
        origem: "falta",
      })
      .select(COLUNAS_DA_MULTA)
      .single();
    if (erroDoInsert) {
      if (erroDoInsert.code === "23505") {
        return fail("conflict", "Esta sessão já tem multa.", 409, { requestId });
      }
      throw erroDoInsert;
    }

    await audit({
      action: "clinica.multa_registrada",
      actorUserId: authz.user.id,
      organizationId: org,
      resourceType: "clinica_multa",
      resourceId: data.id,
      requestId,
      metadata: {
        appointment_id: id,
        origem: "falta",
        percentual: multa.percentual,
        valor_cents: multa.valor_cents,
      },
    });

    return ok(data, { requestId, status: 201 });
  } catch (err) {
    if (moduloClinicaNaoInstalado(err as { code?: string })) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", (err as Error).message ?? String(err), 500, { requestId });
  }
}
