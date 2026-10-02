/**
 * AS REGRAS DA CLÍNICA (módulo clínica, migrations 9002 e 9003): faltas e cancelamento, pacote e
 * acompanhamento. É o que a tela Configurações › Regras da clínica lê e grava.
 *
 * GET e PUT: só `admin` (pedido do Pedro, 02/10/2026: configuração é do administrador, e os
 * outros perfis não a veem). A agenda de todos continua recebendo os PRAZOS que saem destas
 * regras (`falta_liberada_em`, `cancelamento_sem_multa_ate`) pela grade, sem abrir a tela.
 * Sem linha gravada devolve os padrões com `personalizada: false`. PUT é parcial; a RLS cobra o
 * mesmo degrau, e a rota repete pela mensagem.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { COLUNAS_DAS_REGRAS, regrasDaLinha, type RegrasDaClinica } from "@/lib/clinica/agenda";
import { politicaSchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS = COLUNAS_DAS_REGRAS.join(", ");

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "clinica_politicas" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_politicas")
    .select(COLUNAS)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }
  return ok(
    { ...regrasDaLinha(data as Partial<RegrasDaClinica> | null), personalizada: data !== null },
    { requestId },
  );
}

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("admin", { requestId, resource: "clinica_politicas" });
  if (!authz.ok) return authz.response;

  const lido = politicaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinica_politicas")
    .upsert(
      {
        organization_id: authz.org.orgId,
        ...lido.data,
        updated_by_user_id: authz.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    )
    .select(COLUNAS)
    .single();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  await audit({
    action: "clinica.politica_atualizada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "clinica_politica",
    resourceId: authz.org.orgId,
    requestId,
    metadata: lido.data,
  });

  return ok({ ...regrasDaLinha(data as Partial<RegrasDaClinica>), personalizada: true }, { requestId });
}
