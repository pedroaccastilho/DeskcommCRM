/**
 * GET /api/v1/tasks/[id]/repasses — quem passou esta tarefa para quem, e quando.
 *
 * O registro do repasse é a linha `crm_task.reassigned` que o PATCH grava na auditoria
 * (`app/api/v1/tasks/[id]/route.ts`), com `{ de, para }` no metadata. Lida daqui, e não de uma
 * tabela própria, porque a auditoria já é o registro append-only da casa (migration 0258): o
 * histórico que a folha mostra não pode ser reescrito por quem passou a tarefa adiante.
 *
 * A leitura é de qualquer membro (`viewer`+, como a lista de tarefas). A RLS de `api_audit_log`
 * não abre a auditoria para quem atende, então o admin client entra — filtrado à mão pela
 * organização da SESSÃO, pela tarefa e pela ação, e devolvendo só os ids e a hora.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { RepasseDaTarefa } from "@/lib/tarefas/responsavel";

export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("viewer", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
  }

  // A tarefa tem de ser da organização da sessão — sem isto, o id de uma tarefa de outra
  // organização devolveria a lista vazia em vez de 404, e a rota viraria oráculo de existência.
  const supabase = await createClient();
  const { data: tarefa } = await supabase
    .from("crm_tasks")
    .select("id")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!tarefa) return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });

  const client = isServiceRoleConfigured() ? createAdminClient() : supabase;
  const { data, error } = await client
    .from("api_audit_log")
    .select("actor_user_id, metadata, created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("action", "crm_task.reassigned")
    .eq("resource_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return fail("internal_error", t("Erro ao listar as tarefas."), 500, { requestId });
  }

  const repasses: RepasseDaTarefa[] = (
    (data ?? []) as Array<{
      actor_user_id: string | null;
      metadata: { de?: string | null; para?: string | null } | null;
      created_at: string;
    }>
  ).flatMap((linha) =>
    linha.metadata?.para
      ? [
          {
            por: linha.actor_user_id,
            de: linha.metadata.de ?? null,
            para: linha.metadata.para,
            em: linha.created_at,
          },
        ]
      : [],
  );

  return ok({ repasses }, { requestId });
}
