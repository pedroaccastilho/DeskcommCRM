/**
 * A GRADE DA AGENDA DA CLÍNICA — um dia ou uma semana, uma coluna por profissional, cor por
 * modalidade (módulo clínica, migration 9002).
 *
 * GET ?de=ISO&ate=ISO[&profissional=uuid,uuid][&modalidade=fisioterapia,pilates][&incluir_canceladas=1]
 *
 * Devolve `{ profissionais, sessoes, politica }`. `profissionais` são os de saúde ativos (as
 * colunas); uma sessão de quem não está no cadastro vem com o `profissional_user_id` dela e a
 * tela decide onde pô-la. `modalidade` é `null` em compromisso cujo tipo não foi etiquetado em
 * `tipos-atendimento`. Qualquer membro lê: a grade não tem dado clínico.
 *
 * ⚠️ CLIENT DE SESSÃO. A RLS de `calendar_appointments` já limita à organização; o filtro
 * explícito de `organization_id` vai junto, como em toda rota.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import {
  politicaDaLinha,
  sessaoDaGrade,
  type LinhaDoCompromisso,
  type Modalidade,
  type PoliticaDaAgenda,
} from "@/lib/clinica/agenda";
import { gradeQuerySchema } from "@/lib/clinica/agenda-schemas";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIMITE_DE_SESSOES = 2000;

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;

  const lido = gradeQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "consulta inválida", 422, {
      requestId,
    });
  }
  const q = lido.data;
  const org = authz.org.orgId;
  const supabase = await createClient();

  const [profs, etiquetas, politicaLida, tiposDoNucleo] = await Promise.all([
    supabase
      .from("clinica_profissionais")
      .select("user_id, nome_profissional, conselho, modalidades")
      .eq("organization_id", org)
      .eq("ativo", true)
      .order("nome_profissional"),
    supabase
      .from("clinica_tipos_atendimento")
      .select("event_type_id, modalidade")
      .eq("organization_id", org),
    supabase
      .from("clinica_politicas")
      .select("antecedencia_cancelamento_horas, multa_cancelamento_pct, tolerancia_atraso_minutos")
      .eq("organization_id", org)
      .maybeSingle(),
    supabase.from("calendar_event_types").select("id, name").eq("organization_id", org),
  ]);
  for (const r of [profs, etiquetas, politicaLida]) {
    if (r.error && moduloClinicaNaoInstalado(r.error)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
  }
  const erro = profs.error ?? etiquetas.error ?? politicaLida.error ?? tiposDoNucleo.error;
  if (erro) return fail("internal_error", erro.message, 500, { requestId });

  const politica = politicaDaLinha(politicaLida.data as Partial<PoliticaDaAgenda> | null);
  const modalidadeDoTipo = new Map(
    (etiquetas.data ?? []).map((e) => [e.event_type_id as string, e.modalidade as Modalidade]),
  );
  const tipos = new Map(
    (tiposDoNucleo.data ?? []).map((t) => [
      t.id as string,
      {
        nome: t.name as string,
        modalidade: modalidadeDoTipo.get(t.id as string) ?? null,
      },
    ]),
  );

  const profissionais = (profs.data ?? [])
    .filter((p) => q.profissional.length === 0 || q.profissional.includes(p.user_id as string))
    .filter(
      (p) =>
        q.modalidade.length === 0 ||
        (p.modalidades as string[]).some((m) => q.modalidade.includes(m as Modalidade)),
    )
    .map((p) => ({
      user_id: p.user_id as string,
      nome: p.nome_profissional as string,
      conselho: p.conselho as string,
      modalidades: p.modalidades as Modalidade[],
    }));

  let consulta = supabase
    .from("calendar_appointments")
    .select(
      "id, title, starts_at, ends_at, status, owner_user_id, event_type_id, contact_id, contacts(name, display_name, phone_number)",
    )
    .eq("organization_id", org)
    .lt("starts_at", q.ate)
    .gt("ends_at", q.de)
    .order("starts_at")
    .limit(LIMITE_DE_SESSOES);
  if (!q.incluir_canceladas) consulta = consulta.neq("status", "cancelled");
  if (q.profissional.length > 0) consulta = consulta.in("owner_user_id", q.profissional);
  if (q.modalidade.length > 0) {
    const tiposDaModalidade = [...modalidadeDoTipo.entries()]
      .filter(([, m]) => q.modalidade.includes(m))
      .map(([id]) => id);
    if (tiposDaModalidade.length === 0) {
      return ok({ de: q.de, ate: q.ate, profissionais, sessoes: [], politica }, { requestId });
    }
    consulta = consulta.in("event_type_id", tiposDaModalidade);
  }

  const { data, error } = await consulta;
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const sessoes = ((data ?? []) as unknown as LinhaDoCompromisso[]).map((linha) =>
    sessaoDaGrade(linha, tipos, politica),
  );

  return ok({ de: q.de, ate: q.ate, profissionais, sessoes, politica }, { requestId });
}
