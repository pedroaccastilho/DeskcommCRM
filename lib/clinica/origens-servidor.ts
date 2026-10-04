/**
 * ORIGEM DO PACIENTE — leitura e escrita no banco (módulo clínica, migration 9005).
 *
 * ⚠️ ORGANIZAÇÃO SEMPRE DO CONTEXTO. Toda função recebe a organização de quem chamou (cookie
 * validado) e a põe em todo filtro, porque o client de serviço ignora a RLS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

import { moduloClinicaNaoInstalado } from "./api";
import { ORIGENS_PADRAO, type OrigemDaClinica, type TipoDeOrigem } from "./origens";

type SB = SupabaseClient;

export const COLUNAS_DA_ORIGEM = "id, nome, tipo, ativo, ordem, created_at, updated_at";

export class ModuloClinicaAusente extends Error {
  constructor() {
    super("module_not_installed");
  }
}

async function lerOrigens(db: SB, organizationId: string): Promise<OrigemDaClinica[]> {
  const { data, error } = await db
    .from("clinica_origens")
    .select(COLUNAS_DA_ORIGEM)
    .eq("organization_id", organizationId)
    .order("ordem", { ascending: true })
    .order("nome", { ascending: true });
  if (error) {
    if (moduloClinicaNaoInstalado(error)) throw new ModuloClinicaAusente();
    throw error;
  }
  return (data ?? []) as OrigemDaClinica[];
}

/**
 * A lista de origens da clínica. Na primeira leitura de uma clínica que ainda não tem nenhuma,
 * grava a lista padrão (WhatsApp, Instagram, indicação, encaminhamento, outra) pelo client de
 * serviço: quem lê pode ser a recepção, que não escreve na lista. Corrida entre duas leituras
 * não duplica: o nome é único por clínica e a gravação ignora o repetido.
 */
export async function origensDaClinica(
  sessao: SB,
  admin: SB,
  organizationId: string,
): Promise<OrigemDaClinica[]> {
  const lidas = await lerOrigens(sessao, organizationId);
  if (lidas.length > 0) return lidas;
  const { error } = await admin.from("clinica_origens").upsert(
    ORIGENS_PADRAO.map((o) => ({ organization_id: organizationId, ...o })),
    { onConflict: "organization_id,nome", ignoreDuplicates: true },
  );
  if (error) {
    if (moduloClinicaNaoInstalado(error)) throw new ModuloClinicaAusente();
    throw error;
  }
  return lerOrigens(sessao, organizationId);
}

export interface OrigemDoPaciente {
  contact_id: string;
  /** `null` = sem origem: nem a recepção registrou, nem o contato chegou pelo WhatsApp. */
  origem: { id: string; nome: string; tipo: TipoDeOrigem } | null;
  detalhe: string | null;
  indicado_por: { id: string; nome: string } | null;
  /** `true` = calculada de `contacts.source = 'whatsapp'`, sem registro da recepção. */
  automatica: boolean;
  registrado_por_user_id: string | null;
  atualizado_em: string | null;
}

/**
 * A origem do paciente como a ficha mostra: a registrada pela recepção ou, sem ela, "WhatsApp"
 * quando o núcleo registrou o contato pelo WhatsApp. `null` = contato não é desta clínica.
 */
export async function origemDoPaciente(
  db: SB,
  organizationId: string,
  contactId: string,
  origens: readonly OrigemDaClinica[],
): Promise<OrigemDoPaciente | null> {
  const { data: contato, error: erroContato } = await db
    .from("contacts")
    .select("id, source")
    .eq("organization_id", organizationId)
    .eq("id", contactId)
    .maybeSingle();
  if (erroContato) throw erroContato;
  if (!contato) return null;

  const { data, error } = await db
    .from("clinica_pacientes_origem")
    .select(
      "origem_id, detalhe, indicado_por_contact_id, registrado_por_user_id, updated_at, indicou:contacts!clinica_pacientes_origem_indicado_por_contact_id_fkey(id, name, display_name, phone_number)",
    )
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (error) {
    if (moduloClinicaNaoInstalado(error)) throw new ModuloClinicaAusente();
    throw error;
  }

  const porId = new Map(origens.map((o) => [o.id, o]));
  if (data) {
    const linha = data as unknown as {
      origem_id: string;
      detalhe: string | null;
      registrado_por_user_id: string | null;
      updated_at: string;
      indicou: {
        id: string;
        name: string | null;
        display_name: string | null;
        phone_number: string | null;
      } | null;
    };
    const o = porId.get(linha.origem_id);
    return {
      contact_id: contactId,
      origem: o ? { id: o.id, nome: o.nome, tipo: o.tipo } : null,
      detalhe: linha.detalhe,
      indicado_por: linha.indicou
        ? {
            id: linha.indicou.id,
            nome: rotuloDoContato(linha.indicou),
          }
        : null,
      automatica: false,
      registrado_por_user_id: linha.registrado_por_user_id,
      atualizado_em: linha.updated_at,
    };
  }

  const whatsapp =
    (contato as { source: string | null }).source === "whatsapp"
      ? [...origens]
          .filter((o) => o.tipo === "whatsapp")
          .sort((x, y) => Number(y.ativo) - Number(x.ativo) || x.ordem - y.ordem)[0]
      : undefined;
  return {
    contact_id: contactId,
    origem: whatsapp ? { id: whatsapp.id, nome: whatsapp.nome, tipo: whatsapp.tipo } : null,
    detalhe: null,
    indicado_por: null,
    automatica: Boolean(whatsapp),
    registrado_por_user_id: null,
    atualizado_em: null,
  };
}
