/**
 * O HISTÓRICO DE UMA SESSÃO — remarcações (de quando para quando), cancelamento, falta,
 * realização e confirmação, com quem fez (módulo clínica, migration 9002).
 *
 * `por_tipo`: `user` (pessoa da equipe, com `por_nome`), `ai` (o agente no WhatsApp) ou `system`.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { isServiceRoleConfigured } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Sessão não encontrada.", 404, { requestId });
  }

  const supabase = await createClient();
  const org = authz.org.orgId;
  const { data, error } = await supabase
    .from("clinica_agenda_historico")
    .select("id, acao, de_inicio, para_inicio, motivo, por_tipo, por_user_id, registrado_em")
    .eq("organization_id", org)
    .eq("appointment_id", id)
    .order("registrado_em");
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  // O nome de quem fez: o do conselho, se for profissional de saúde; senão o do perfil. Sem
  // service role configurada (dev), o nome fica nulo e a tela mostra só a espécie.
  const ids = [...new Set((data ?? []).map((h) => h.por_user_id).filter(Boolean))] as string[];
  const nomes = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from("clinica_profissionais")
      .select("user_id, nome_profissional")
      .eq("organization_id", org)
      .in("user_id", ids);
    for (const p of profs ?? []) nomes.set(p.user_id as string, p.nome_profissional as string);
    if (isServiceRoleConfigured()) {
      const admin = createAdminClient();
      await Promise.all(
        ids
          .filter((uid) => !nomes.has(uid))
          .map(async (uid) => {
            const { data: u } = await admin.auth.admin.getUserById(uid);
            const nome = (u?.user?.user_metadata?.full_name as string | undefined) ?? u?.user?.email;
            if (nome) nomes.set(uid, nome);
          }),
      );
    }
  }

  return ok(
    (data ?? []).map((h) => ({
      ...h,
      por_nome: h.por_user_id ? nomes.get(h.por_user_id as string) || null : null,
    })),
    { requestId },
  );
}
