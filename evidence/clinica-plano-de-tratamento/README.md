# Plano de tratamento e retorno de reavaliação (migration 9006)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado do zero e o app em `next build` +
`next start`, dirigida por `tests/e2e/clinica-plano-de-tratamento.spec.ts`. Sem WhatsApp conectado,
como num primeiro deploy.

- `1-avaliacao.png`: o fisioterapeuta preenche a avaliação com 10 sessões, 2x por semana e a data da
  reavaliação (daqui a 7 dias).
- `2-retorno-marcado.png`: ao assinar, a ficha mostra "Sessão 1 de 10", a etapa "Avaliado" e o
  retorno já marcado na agenda de quem avaliou, no dia pedido. Como não há WhatsApp conectado, o
  cartão e o aviso dizem que a confirmação não saiu e que a recepção avisa o paciente (a tarefa é
  criada para a recepção).
- `3-plano-na-ficha.png`: depois de uma sessão atendida, a aba Visão geral (a que a recepção usa)
  mostra "Sessão 2 de 10" e a etapa "Em tratamento". O diagnóstico não aparece no cartão.
