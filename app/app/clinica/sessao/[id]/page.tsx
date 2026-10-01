import { notFound, redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * DA SESSÃO DA AGENDA PARA A EVOLUÇÃO — módulo clínica (fork TOQ).
 *
 * A agenda conhece o compromisso, não o paciente (o tipo `Agendamento` da grade não carrega
 * `contact_id`). Esta rota resolve o paciente no servidor, pelo client de sessão e com a RLS da
 * agenda, e leva à aba Prontuário da ficha com a sessão já vinculada ao formulário.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");

  const supabase = await createClient();
  const { data } = await supabase
    .from("calendar_appointments")
    .select("contact_id")
    .eq("organization_id", org.orgId)
    .eq("id", id)
    .maybeSingle();

  const contato = (data as { contact_id: string | null } | null)?.contact_id;
  if (!contato) notFound();
  redirect(`/app/contacts/${contato}?aba=prontuario&sessao=${encodeURIComponent(id)}`);
}
