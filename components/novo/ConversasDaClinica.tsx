"use client";

/**
 * A caixa de entrada do WhatsApp na casca da interface nova.
 *
 * Reaproveita `InboxLayout` inteiro em vez de reescrever a conversa: ali moram o tempo real, a
 * janela de 24h, o composer com mídia e modelos, as notas, a passagem para humano e a ligação.
 * Reescrever tudo isso em paralelo dobraria o código que mais quebra. O que muda aqui é a roupa:
 * `.n-inbox` reaponta as cores da interface atual para a paleta da interface nova (claro e escuro)
 * e acerta a altura para a casca nova, que não tem o cabeçalho de 3,5rem da versão atual.
 *
 * Os três provedores são os que `/app/layout.tsx` põe em volta da caixa de entrada: a cor das
 * etiquetas, a ligação (o botão de ligar do cabeçalho exige o provedor) e o rodapé ocupado.
 */
import { InboxLayout } from "@/components/inbox/InboxLayout";
import { ProvedorDeCoresDasEtiquetas } from "@/components/tags/CoresDasEtiquetas";
import { VoiceCallProvider } from "@/components/voice/VoiceCallContext";
import type { AvisoDeRascunho } from "@/lib/inbox/rascunho-sugerido";
import { ProvedorDaOcupacaoDoRodape } from "@/lib/ui/rodape-ocupado";

export function ConversasDaClinica({
  conversaInicial,
  rascunho,
}: {
  conversaInicial: string | null;
  rascunho: AvisoDeRascunho | null;
}) {
  return (
    <ProvedorDeCoresDasEtiquetas>
      <ProvedorDaOcupacaoDoRodape>
        <VoiceCallProvider>
          <div className="n-inbox" data-testid="novo-whatsapp">
            <InboxLayout initialSelectedId={conversaInicial} rascunho={rascunho} />
          </div>
        </VoiceCallProvider>
      </ProvedorDaOcupacaoDoRodape>
    </ProvedorDeCoresDasEtiquetas>
  );
}
