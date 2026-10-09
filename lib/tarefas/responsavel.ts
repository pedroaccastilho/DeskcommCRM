import { isServiceRoleConfigured } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * O RESPONSÁVEL DA TAREFA: alguém da equipe que vai resolvê-la.
 *
 * `crm_tasks.assigned_to` (migration 0210) é FK para `auth.users`, e só isso: o banco aceitaria
 * o id de uma pessoa de OUTRA organização, ou de quem já saiu da equipe. Esta função é a cerca
 * que falta, usada pelas rotas de tarefa antes de gravar um responsável que não é quem pede.
 *
 * Quem pode receber: membro ATIVO da organização (`revoked_at` nulo) com papel acima de `viewer`
 * — o "Somente leitura" não consegue marcar a tarefa como feita, então passar a tarefa para ele
 * seria criar uma tarefa que ninguém resolve. É a mesma regra de `/api/v1/team/assignable`, de
 * onde a tela tira a lista.
 *
 * Admin client porque a RLS de `user_organizations` só mostra a um `agent` a própria linha; o
 * filtro de `organization_id` vem da sessão do chamador, nunca do corpo.
 */
export async function podeSerResponsavel(organizationId: string, userId: string): Promise<boolean> {
  const client = isServiceRoleConfigured() ? createAdminClient() : await createClient();
  const { data, error } = await client
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .neq("role", "viewer")
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/** Um repasse, como `GET /api/v1/tasks/[id]/repasses` devolve. */
export interface RepasseDaTarefa {
  /** Quem passou. */
  por: string | null;
  /** Responsável antes (nulo = a tarefa estava sem responsável). */
  de: string | null;
  para: string;
  em: string;
}
