import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A organização escolheu a interface nova como a principal de quem não administra?
 * (`clinica_politicas.interface_nova_principal`, migration 9010.)
 *
 * NUNCA lança: roda no layout de `/app`, e um throw ali é 500 em todas as telas. Sem a linha,
 * sem a tabela (módulo fora) ou sem a coluna (módulo instalado antes da 9010 e ainda não
 * reaplicado), a resposta é "não" e a interface atual segue como sempre.
 */
export async function interfaceNovaEhPrincipal(
  admin: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from("clinica_politicas")
      .select("interface_nova_principal")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) return false;
    return (
      (data as { interface_nova_principal?: boolean } | null)?.interface_nova_principal === true
    );
  } catch {
    return false;
  }
}
