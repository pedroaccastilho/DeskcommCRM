import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";

import { ChatbotDoWhatsApp } from "./_client";

export const dynamic = "force-dynamic";

/**
 * CHATBOT DO WHATSAPP — módulo opcional clínica (fork TOQ).
 *
 * Pedido do Pedro (02/10/2026): responder o WhatsApp com um chatbot sem IA, montado num
 * construtor visual de caixas e setas (como o editor de fluxos dos Follow-ups), uma conversa por
 * conexão. Ligado numa conexão, ele responde no lugar da IA nela.
 *
 * `manager`+, o mesmo degrau de Agentes e Follow-ups. A rota cobra o mesmo; aqui é só a tela.
 */
export default async function Page() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) redirect("/app");
  if (ROLE_RANK[org.role] < ROLE_RANK.manager) redirect("/app/settings");
  const t = (texto: string) => traduzir(texto, user.idioma);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("Chatbot do WhatsApp")}</h1>
        <p className="text-sm text-text-muted">
          {t(
            "Monte em caixas e setas a conversa que responde o WhatsApp sem IA: menus, perguntas, marcação, remarcação e cancelamento de horários e a passagem para a recepção.",
          )}
        </p>
      </div>
      <ChatbotDoWhatsApp />
    </div>
  );
}
