/**
 * A CONFIRMAÇÃO DO RETORNO PELO WHATSAPP — o paciente fica sabendo, na hora, que a reavaliação
 * já está marcada (módulo clínica, migration 9006).
 *
 * É mensagem transacional, como o lembrete da agenda (`app/api/v1/cron/agenda-reminder`), e
 * segue as mesmas travas dele: organização parada não envia (o próprio envio recusa), contato bloqueado ou sem telefone
 * não recebe, sem conexão de WhatsApp ativa não há por onde mandar, e fora da janela de envio do
 * canal NÃO manda (mensagem às 23h é o que faz o número ser denunciado).
 *
 * ⚠️ NUNCA LANÇA. Quem chama é a assinatura da avaliação, que já está gravada: um aviso que não
 * saiu não pode virar erro para o profissional. O desfecho volta como `enviado` ou com o motivo,
 * e quem chama abre uma tarefa para a recepção avisar o paciente quando não saiu.
 *
 * O desfecho é lido do `status` da mensagem devolvida, não da ausência de exceção:
 * `sendMessageHandler` grava canal em teste, canal arquivado e recusa do transporte como
 * `failed` DENTRO da linha e volta normal (o defeito que `lib/ai/handoff/aviso-ao-lead.ts`
 * documenta).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { tagDeIdioma } from "@/lib/i18n/datas";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { OrgNaoOperanteError } from "@/lib/organizacao/operante";

export type DesfechoDoAviso =
  | { enviado: true }
  | {
      enviado: false;
      motivo:
        | "org_parada"
        | "contato_bloqueado"
        | "sem_telefone"
        | "sem_canal"
        | "fora_da_janela"
        | "nao_entregue"
        | "erro";
    };

/** O texto da confirmação. Puro e exportado: é o que o paciente lê, e o teste o prende. */
export function textoDaConfirmacaoDoRetorno(input: {
  nomeDoPaciente: string | null;
  profissional: string;
  quando: Date;
  fuso: string;
  idioma?: Idioma;
}): string {
  const idioma = input.idioma ?? IDIOMA_PADRAO;
  const t = (texto: string) => traduzir(texto, idioma);
  const etiqueta = tagDeIdioma(idioma);
  const dia = new Intl.DateTimeFormat(etiqueta, {
    timeZone: input.fuso,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(input.quando);
  const hora = new Intl.DateTimeFormat(etiqueta, {
    timeZone: input.fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(input.quando);
  const nome = input.nomeDoPaciente?.trim() ?? "";
  const saudacao = nome ? `${t("Oi,")} ${nome}!` : t("Oi!");
  return (
    `${saudacao} ${t("Seu retorno de reavaliação com {profissional} ficou marcado para {quando}.")
      .replace("{profissional}", input.profissional)
      .replace("{quando}", `${dia} ${t("às")} ${hora}`)} ` +
    t("Se precisar mudar, é só responder esta mensagem.")
  );
}

export async function avisarPacienteDoRetorno(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    contactId: string;
    appointmentId: string;
    profissional: string;
    quando: Date;
    fuso: string;
  },
): Promise<DesfechoDoAviso> {
  const org = input.organizationId;
  try {
    const { data: contato } = await admin
      .from("contacts")
      .select("id, name, display_name, phone_number, is_blocked")
      .eq("id", input.contactId)
      .eq("organization_id", org)
      .maybeSingle();
    if (!contato || contato.is_blocked) return { enviado: false, motivo: "contato_bloqueado" };
    if (!contato.phone_number) return { enviado: false, motivo: "sem_telefone" };

    const { data: canal } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", org)
      .eq("status", "WORKING")
      .limit(1)
      .maybeSingle();
    if (!canal) return { enviado: false, motivo: "sem_canal" };

    if (await adiarAteAJanelaAbrir(admin, org, canal.id)) {
      return { enviado: false, motivo: "fora_da_janela" };
    }

    const { data: organizacao } = await admin
      .from("organizations")
      .select("locale")
      .eq("id", org)
      .maybeSingle();

    const corpo = textoDaConfirmacaoDoRetorno({
      nomeDoPaciente: nomeDoContato(contato),
      profissional: input.profissional,
      quando: input.quando,
      fuso: input.fuso,
      idioma: normalizarIdioma(organizacao?.locale),
    });

    const conversaId = await ensureConversation(admin, org, contato.id, canal.id);
    // `webhook_source`: envio nascido do sistema, não de uma pessoa (o mesmo ator do lembrete).
    // O `id` é o compromisso, para o audit da mensagem correlacionar com o retorno.
    const mensagem = await sendMessageHandler(
      admin,
      {
        organization_id: org,
        actor: { type: "webhook_source", id: input.appointmentId },
        requestId: `clinica-retorno:${input.appointmentId}`,
      },
      { conversation_id: conversaId, type: "text", body: corpo } as Parameters<
        typeof sendMessageHandler
      >[2],
    );

    // Organização parada é recusada dentro do envio (`OrgNaoOperanteError`, tratado abaixo).
    if (mensagem.status === "failed") return { enviado: false, motivo: "nao_entregue" };
    return { enviado: true };
  } catch (err) {
    // A organização parou entre a leitura e o envio: não é erro, é a suspensão.
    if (err instanceof OrgNaoOperanteError) return { enviado: false, motivo: "org_parada" };
    logger.warn("clinica_aviso_do_retorno_falhou", {
      appointmentId: input.appointmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { enviado: false, motivo: "erro" };
  }
}
