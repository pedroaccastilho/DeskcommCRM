/**
 * O CHATBOT de cada conexão de WhatsApp (módulo clínica, fork TOQ): o fluxo desenhado no
 * construtor e o liga/desliga. É o que a tela Configurações › Chatbot do WhatsApp lê e grava.
 *
 * GET: as conexões da organização, cada uma com a configuração do chatbot (ou o modelo padrão,
 * com `configurado: false`). PUT: grava a configuração de UMA conexão, recusando o fluxo com
 * problema de desenho (`problemasDoFluxo`) — o mesmo critério com que o executor se recusa a
 * rodá-lo, para "salvo" nunca querer dizer "salvo e mudo".
 *
 * Papel: `manager`+, o mesmo degrau de quem monta Agentes e Follow-ups, que é o trabalho que o
 * chatbot substitui. A configuração mora em `channel_sessions.metadata.chatbot_fluxo`
 * (`lib/clinica/chatbot/fluxo.ts`); a escrita junta a chave ao `metadata` que já existe, sem
 * apagar `ai_gate` e o resto. Cliente service role, então TODA consulta filtra a organização
 * resolvida da sessão, nunca do corpo.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { z } from "zod";

import { listaTiposDeAtendimento } from "@/lib/agenda/consulta";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import {
  CHAVE_NO_METADATA,
  CONFIG_PADRAO,
  configDoChatbotSchema,
  configDoMetadata,
  problemasDoFluxo,
} from "@/lib/clinica/chatbot/fluxo";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface LinhaDaConexao {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  metadata: unknown;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "channel_sessions" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("channel_sessions")
    .select("id, display_name, phone_number, status, metadata")
    .eq("organization_id", authz.org.orgId)
    .is("archived_at", null)
    .order("created_at");
  if (error)
    return fail("internal_error", "Não foi possível carregar as conexões.", 500, { requestId });

  const conexoes = ((data ?? []) as LinhaDaConexao[]).map((c) => {
    const config = configDoMetadata(c.metadata);
    return {
      channel_session_id: c.id,
      nome: c.display_name,
      telefone: c.phone_number,
      status: c.status,
      configurado: config !== null,
      config: config ?? CONFIG_PADRAO,
    };
  });
  // Os atendimentos que a caixa "Marcar horário" pode fixar: a MESMA lista que o chatbot usa
  // para marcar (`listaTiposDeAtendimento`). Sem eles a caixa ainda funciona (o paciente escolhe).
  const lidos = await listaTiposDeAtendimento(admin, authz.org.orgId);
  const tipos = lidos.ok ? lidos.tipos.map((t) => ({ id: t.id, nome: t.nome })) : [];
  return ok({ conexoes, tipos }, { requestId });
}

const putSchema = z.strictObject({
  channel_session_id: z.uuid(),
  config: configDoChatbotSchema,
});

export async function PUT(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("manager", { requestId, resource: "channel_sessions" });
  if (!authz.ok) return authz.response;

  const lido = putSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail(
      "validation_failed",
      lido.error.issues[0]?.message ?? "Configuração inválida.",
      422,
      {
        requestId,
      },
    );
  }
  const { channel_session_id: id, config } = lido.data;
  const problemas = problemasDoFluxo(config.fluxo);
  if (problemas.length > 0) {
    return fail("validation_failed", problemas[0]!.mensagem, 422, {
      requestId,
      details: { problemas },
    });
  }

  const admin = createAdminClient();
  const { data: atual, error: erroLeitura } = await admin
    .from("channel_sessions")
    .select("metadata")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (erroLeitura)
    return fail("internal_error", "Não foi possível carregar a conexão.", 500, { requestId });
  if (!atual) return fail("not_found", "Conexão não encontrada.", 404, { requestId });

  const base =
    atual.metadata && typeof atual.metadata === "object" && !Array.isArray(atual.metadata)
      ? (atual.metadata as Record<string, unknown>)
      : {};
  const { error: erroEscrita } = await admin
    .from("channel_sessions")
    .update({ metadata: { ...base, [CHAVE_NO_METADATA]: config } })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);
  if (erroEscrita)
    return fail("internal_error", "Não foi possível salvar o chatbot.", 500, { requestId });

  void audit({
    action: "clinica.chatbot_menu_atualizado",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: {
      ativo: config.ativo,
      caixas: config.fluxo.nos.length,
      tipos: [...new Set(config.fluxo.nos.map((n) => n.tipo))],
    },
  });

  return ok({ channel_session_id: id, configurado: true, config }, { requestId });
}
