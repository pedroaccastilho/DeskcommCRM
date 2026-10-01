/**
 * EVOLUÇÕES PENDENTES DE QUEM ESTÁ LOGADO — sessões da agenda que já aconteceram e ainda não têm
 * registro no prontuário (módulo clínica, fork TOQ).
 *
 * Régua: compromissos em que a pessoa é a responsável (`owner_user_id`), com paciente
 * vinculado, que começaram nos últimos DIAS_DA_JANELA dias e não foram cancelados nem marcados
 * como falta. Pendente é a sessão sem nenhum registro que aponte para ela (`appointment_id`),
 * de qualquer profissional: uma sessão com evolução escrita por um colega já foi registrada.
 *
 * ⚠️ CLIENT DE SESSÃO. Quem não é profissional ativo não lê `prontuario_registros` (RLS), e
 * para essa pessoa toda sessão pareceria pendente; por isso a rota devolve lista vazia antes
 * de perguntar.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DIAS_DA_JANELA = 30;
/** Regra da clínica: evolução no mesmo dia; passadas 24h da sessão, a pendência está atrasada. */
const HORAS_ATE_ATRASAR = 24;

type Sessao = {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  contact_id: string;
  contacts: {
    name: string | null;
    display_name: string | null;
    phone_number: string | null;
  } | null;
};

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "prontuario_registros" });
  if (!authz.ok) return authz.response;
  if (authz.user.support) return ok([], { requestId });

  const supabase = await createClient();
  const orgId = authz.org.orgId;

  const { data: cadastro, error: erroDoCadastro } = await supabase
    .from("clinica_profissionais")
    .select("ativo")
    .eq("organization_id", orgId)
    .eq("user_id", authz.user.id)
    .maybeSingle();
  if (erroDoCadastro) {
    if (moduloClinicaNaoInstalado(erroDoCadastro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erroDoCadastro.message, 500, { requestId });
  }
  if (!cadastro?.ativo) return ok([], { requestId });

  const agora = new Date();
  const inicio = new Date(agora.getTime() - DIAS_DA_JANELA * 24 * 60 * 60 * 1000);
  const { data: sessoes, error: erroDaAgenda } = await supabase
    .from("calendar_appointments")
    .select("id, title, starts_at, status, contact_id, contacts(name, display_name, phone_number)")
    .eq("organization_id", orgId)
    .eq("owner_user_id", authz.user.id)
    .not("contact_id", "is", null)
    .in("status", ["pending", "confirmed", "completed"])
    .gte("starts_at", inicio.toISOString())
    .lte("starts_at", agora.toISOString())
    .order("starts_at", { ascending: false })
    .limit(200);
  if (erroDaAgenda) return fail("internal_error", erroDaAgenda.message, 500, { requestId });

  const lista = (sessoes ?? []) as unknown as Sessao[];
  if (lista.length === 0) return ok([], { requestId });

  const { data: registradas, error: erroDoProntuario } = await supabase
    .from("prontuario_registros")
    .select("appointment_id")
    .eq("organization_id", orgId)
    .in(
      "appointment_id",
      lista.map((s) => s.id),
    );
  if (erroDoProntuario) {
    return fail("internal_error", erroDoProntuario.message, 500, { requestId });
  }

  const comRegistro = new Set(
    (registradas ?? []).map((r) => (r as { appointment_id: string | null }).appointment_id),
  );
  const pendentes = lista
    .filter((s) => !comRegistro.has(s.id))
    .map((s) => ({
      appointment_id: s.id,
      titulo: s.title,
      comeca: s.starts_at,
      situacao: s.status,
      atrasada: agora.getTime() - new Date(s.starts_at).getTime() > HORAS_ATE_ATRASAR * 3_600_000,
      contact_id: s.contact_id,
      contato: s.contacts,
    }));

  return ok(pendentes, { requestId });
}
