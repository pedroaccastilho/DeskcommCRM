/**
 * A EQUIPE DA CLÍNICA COM OS PERFIS DE CADA UM (migration 9008) — o que a tela de equipe do
 * administrador mostra: quem já entrou, com os perfis (gravados ou calculados, ver
 * `lib/clinica/cargos.ts`) e o registro do conselho, e os convites em aberto com os perfis
 * escolhidos.
 *
 * Só `admin`: cadastrar a equipe é do administrador da clínica (Pedro, 2026-10-04). A lista de
 * profissionais em si continua legível por qualquer membro em `/api/v1/clinica/profissionais`.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import type { Role } from "@/lib/auth/types";
import { MODULO_CLINICA_NAO_INSTALADO, moduloClinicaNaoInstalado } from "@/lib/clinica/api";
import { cargosDoUsuario } from "@/lib/clinica/cargos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { conviteEstaEmAberto, linkDeAceite, type ConviteDeTime } from "@/lib/team/convites";

export const dynamic = "force-dynamic";

interface Profissional {
  user_id: string;
  nome_profissional: string;
  conselho: string;
  registro_numero: string;
  registro_uf: string;
  modalidades: string[];
  ativo: boolean;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "clinica_equipe" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const db = await createClient();
  const [vinculos, profissionais, convites, cargosDosConvites, cargosGravados] = await Promise.all([
    db
      .from("user_organizations")
      .select("user_id, role, created_at")
      .eq("organization_id", orgId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true }),
    db
      .from("clinica_profissionais")
      .select(
        "user_id, nome_profissional, conselho, registro_numero, registro_uf, modalidades, ativo",
      )
      .eq("organization_id", orgId),
    db
      .from("team_invites")
      .select(
        "id, organization_id, email, role, interface_settings, invited_by, inviter_name, email_dispatched, created_at, last_sent_at, resend_count, expires_at, accepted_at, revoked_at",
      )
      .eq("organization_id", orgId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    db
      .from("clinica_convites_cargos")
      .select("invite_id, cargos, nome_profissional, registro_numero, registro_uf")
      .eq("organization_id", orgId),
    db.from("clinica_cargos_membro").select("user_id, cargo").eq("organization_id", orgId),
  ]);

  const erro =
    vinculos.error ??
    profissionais.error ??
    convites.error ??
    cargosDosConvites.error ??
    cargosGravados.error;
  if (erro) {
    if (moduloClinicaNaoInstalado(erro)) {
      return fail("module_not_installed", MODULO_CLINICA_NAO_INSTALADO, 409, { requestId });
    }
    return fail("internal_error", erro.message, 500, { requestId });
  }

  const porUsuario = new Map(
    ((profissionais.data ?? []) as Profissional[]).map((p) => [p.user_id, p]),
  );
  const gravadosPorUsuario = new Map<string, string[]>();
  for (const linha of cargosGravados.data ?? []) {
    const lista = gravadosPorUsuario.get(linha.user_id as string) ?? [];
    lista.push(linha.cargo as string);
    gravadosPorUsuario.set(linha.user_id as string, lista);
  }
  const admin = isServiceRoleConfigured() ? createAdminClient() : null;

  const membros = await Promise.all(
    (vinculos.data ?? []).map(async (v) => {
      const profissional = porUsuario.get(v.user_id as string) ?? null;
      let email: string | null = null;
      let nome: string | null = null;
      if (admin) {
        const { data } = await admin.auth.admin.getUserById(v.user_id as string);
        email = data?.user?.email ?? null;
        nome = (data?.user?.user_metadata?.full_name as string | undefined) ?? null;
      }
      return {
        user_id: v.user_id as string,
        nome: profissional?.nome_profissional ?? nome ?? email?.split("@")[0] ?? "—",
        email,
        role: v.role as Role,
        cargos: cargosDoUsuario(
          v.role as Role,
          profissional,
          gravadosPorUsuario.get(v.user_id as string),
        ),
        profissional,
        sou_eu: v.user_id === authz.user.id,
      };
    }),
  );

  const cargoPorConvite = new Map(
    (cargosDosConvites.data ?? []).map((c) => [c.invite_id as string, c]),
  );
  const agora = Date.now();
  const pendentes = ((convites.data ?? []) as ConviteDeTime[]).map((c) => {
    const saude = cargoPorConvite.get(c.id);
    const cargos = cargosDoUsuario(
      c.role as Role,
      null,
      (saude?.cargos as string[] | undefined) ?? [],
    );
    return {
      id: c.id,
      email: c.email,
      cargos,
      nome_profissional: (saude?.nome_profissional as string | undefined) ?? null,
      expires_at: c.expires_at,
      email_dispatched: c.email_dispatched,
      expirado: Date.parse(c.expires_at) < agora,
      accept_url: conviteEstaEmAberto(c, agora) ? linkDeAceite(c) : null,
    };
  });

  return ok({ membros, convites: pendentes }, { requestId });
}
