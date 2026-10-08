# Ficha e Hoje completos na interface nova

Spec: `tests/e2e/clinica-ficha-completa.spec.ts` (banco local do baseline, `next build` + `next start`).

| Foto | O que prova |
|---|---|
| `1-ficha-bloqueada.png` | Contato que pediu para não receber mensagens: aviso na ficha, botão de WhatsApp e o "Desbloquear" do administrador |
| `2-confirmar-desbloqueio.png` | A confirmação com o mesmo texto da ficha da versão atual (volta a permitir campanhas, follow-ups e IA; fica na auditoria) |
| `3-whatsapp-pela-ficha.png` | O botão de WhatsApp abre a conversa do paciente na caixa nova (`/whatsapp?id=…`) |
| `4-observacao-na-folha.png` | A Observação de quem marcou aparece na folha da sessão do Hoje |
| `5-prontuario-filtrado.png` | O prontuário filtrado por modalidade (Pilates): só o registro de pilates |
| `6-agendar-com-observacao.png` | Agendar com a Observação, que o banco grava em `calendar_appointments.description` |
| `7-todas-as-pendencias.png` | "Ver todas" abre as sete evoluções pendentes, não só as seis primeiras |
| `8-celular.png` | Ficha no celular: os botões descem para baixo do nome, sem rolagem lateral |
