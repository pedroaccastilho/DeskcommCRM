import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * PATCH  /api/v1/tasks/[id] — edita uma tarefa.
 * DELETE /api/v1/tasks/[id] — apaga uma tarefa.
 *
 * Extraído do PR #418 (@clinicacentrodosorrisosc-code), sem o fallback para
 * `custom_fields.tasks` — o motivo inteiro está no cabeçalho de
 * `app/api/v1/tasks/route.ts`.
 *
 * ⚠️ O `.eq("organization_id", ...)` não é decoração: sem ele o PATCH casaria
 * 0 linhas numa tarefa de outra organização e o PostgREST devolveria `PGRST116`
 * — que esta rota já traduz para 404, o desfecho certo. Mantê-lo explícito é a
 * regra do CLAUDE.md e o que segura o dia em que alguém trocar o client.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";
import { registraAtividadeDaTarefa } from "@/lib/tarefas/atividade";
import { podeSerResponsavel } from "@/lib/tarefas/responsavel";
import { PRIORIDADES_DA_TAREFA, SITUACOES_DA_TAREFA, type Tarefa } from "@/lib/tarefas/tipos";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, organization_id, title, description, due_date, priority, status, lead_id, contact_id, assigned_to, created_by, created_at, updated_at";

const edicaoSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    due_date: z.string().datetime({ offset: true }).nullable().optional(),
    priority: z.enum(PRIORIDADES_DA_TAREFA).optional(),
    status: z.enum(SITUACOES_DA_TAREFA).optional(),
    lead_id: z.string().uuid().nullable().optional(),
    contact_id: z.string().uuid().nullable().optional(),
    // Sem `.nullable()`: a tarefa tem sempre alguém que vai resolvê-la. Passar para outra pessoa
    // é trocar o responsável, nunca tirar.
    assigned_to: z.string().uuid().optional(),
  })
  // PATCH vazio gravaria só o `updated_at` e devolveria 200: a tela diria
  // "salvo" sobre uma edição que não existiu.
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar." });

interface Contexto {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const parsed = edicaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Dados inválidos."), 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }

  const supabase = await createClient();

  // A situação ANTES da edição decide se esta é a vez em que a tarefa fechou.
  // Sem ler antes, marcar "concluída" duas vezes emitiria duas linhas na
  // timeline do negócio — e a segunda seria mentira. O responsável antes decide,
  // do mesmo jeito, se houve repasse.
  const { data: antesLido } = await supabase
    .from("crm_tasks")
    .select("status, assigned_to")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  const antes = antesLido as { status?: string; assigned_to?: string | null } | null;

  // Qualquer pessoa da equipe pode passar a tarefa para outra — a cerca é só que o destino seja
  // da equipe (a FK aceitaria alguém de outra organização).
  const novoResponsavel = parsed.data.assigned_to;
  const repassou =
    novoResponsavel !== undefined && novoResponsavel !== (antes?.assigned_to ?? null);
  if (
    repassou &&
    novoResponsavel !== authz.user.id &&
    !(await podeSerResponsavel(authz.org.orgId, novoResponsavel))
  ) {
    return fail("validation_failed", t("O responsável escolhido não é da equipe."), 422, {
      requestId,
    });
  }

  const { data, error } = await supabase
    .from("crm_tasks")
    .update(parsed.data)
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select(COLUNAS)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
    }
    if (error.code === "23503") {
      return fail("validation_failed", t("O negócio ou contato vinculado não existe."), 422, {
        requestId,
      });
    }
    return fail("internal_error", t("Erro ao salvar a tarefa."), 500, { requestId });
  }

  const tarefa = data as unknown as Tarefa;

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_task.updated",
    resourceType: "crm_tasks",
    resourceId: tarefa.id,
    requestId,
    metadata: { campos: Object.keys(parsed.data) },
  });

  // O repasse fica registrado: quem passou, de quem, para quem e quando. A auditoria é
  // append-only (migration 0258), e é dela que `GET /api/v1/tasks/[id]/repasses` lê o histórico
  // que a folha da tarefa mostra.
  if (repassou) {
    await audit({
      organizationId: authz.org.orgId,
      actorUserId: authz.user.id,
      action: "crm_task.reassigned",
      resourceType: "crm_tasks",
      resourceId: tarefa.id,
      requestId,
      metadata: { de: antes?.assigned_to ?? null, para: tarefa.assigned_to },
    });
  }

  const fechouAgora = tarefa.status === "done" && antes?.status !== "done";
  if (fechouAgora) {
    await registraAtividadeDaTarefa(supabase, {
      organizationId: authz.org.orgId,
      tarefa,
      tipo: "task_completed",
      actor: { type: "user", id: authz.user.id },
    });
  }

  return ok({ task: tarefa }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const { id } = await ctx.params;

  const authz = await requireRole("agent", { requestId, resource: "crm_tasks" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const supabase = await createClient();
  // `.select()` no delete para saber se ALGUMA linha saiu. Sem isso, apagar uma
  // tarefa de outra organização devolveria 200 — e a tela sumiria com a linha
  // do próprio usuário na próxima recarga, sem que nada tivesse sido apagado.
  const { data, error } = await supabase
    .from("crm_tasks")
    .delete()
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .select("id");

  if (error) {
    return fail("internal_error", t("Erro ao apagar a tarefa."), 500, { requestId });
  }
  if (!data || data.length === 0) {
    return fail("not_found", t("Tarefa não encontrada."), 404, { requestId });
  }

  await audit({
    organizationId: authz.org.orgId,
    actorUserId: authz.user.id,
    action: "crm_task.deleted",
    resourceType: "crm_tasks",
    resourceId: id,
    requestId,
  });

  return ok({ deleted: true }, { requestId });
}
