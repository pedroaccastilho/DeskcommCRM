import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * `/app/leads/[id]` na interface nova: como lá, um negócio abre no quadro do funil dele, com o
 * cartão aberto — só que no quadro daqui (`/ajustes/funis/[id]`). Mesma leitura de lá: sessão
 * (RLS) e filtro explícito da organização ativa, para um link de outra organização não trocá-la.
 */
export default async function NegocioNaInterfaceNova({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) notFound();
  const { id } = await params;
  const supabase = await createClient();
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!lead?.pipeline_id) notFound();
  redirect(`/ajustes/funis/${lead.pipeline_id}?lead=${lead.id}`);
}
