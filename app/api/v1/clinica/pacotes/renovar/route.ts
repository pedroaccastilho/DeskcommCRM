/**
 * PACOTES PERTO DO FIM — a lista de renovação da recepção (módulo clínica, migration 9004).
 *
 * GET → pacotes ativos com saldo no limite das Regras da clínica ("avisar a renovação quando
 * restarem N sessões", 2 no padrão), com o paciente. Os que vencem antes vêm primeiro. Recepção
 * para cima (`agent`+).
 *
 * É uma lista do módulo, e não um aviso na Central: o tipo de aviso da Central é vocabulário do
 * núcleo (CHECK em `agent_inbox_items.kind`), e um módulo não o estende (ADR-0002).
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import {
  COLUNAS_DO_PACOTE,
  pacoteComSaldo,
  regrasDaOrganizacao,
  type LinhaDoPacote,
} from "@/lib/clinica/pacotes-servidor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type LinhaComPaciente = LinhaDoPacote & {
  contacts: { name: string | null; display_name: string | null; phone_number: string | null } | null;
};

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "clinica_pacotes" });
  if (!authz.ok) return authz.response;

  const supabase = await createClient();
  const org = authz.org.orgId;
  const agora = new Date();
  const { data, error } = await supabase
    .from("clinica_pacotes")
    .select(`${COLUNAS_DO_PACOTE}, contacts(name, display_name, phone_number)`)
    .eq("organization_id", org)
    .eq("status", "ativo")
    .gte("valido_ate", agora.toISOString())
    .order("valido_ate", { ascending: true })
    .limit(1000);
  if (error) {
    if (moduloClinicaNaoInstalado(error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const regras = await regrasDaOrganizacao(supabase, org);
  const limite = regras.sessoes_restantes_aviso_renovacao;
  const lista = ((data ?? []) as unknown as LinhaComPaciente[])
    .map(({ contacts, ...linha }) => ({ ...pacoteComSaldo(linha, limite, agora), paciente: contacts }))
    .filter((p) => p.precisa_renovar);
  return ok(lista, { requestId, meta: { total: lista.length } });
}
