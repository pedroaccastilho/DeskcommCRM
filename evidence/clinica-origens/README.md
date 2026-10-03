# Origem do paciente (migration 9005)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-origens.spec.ts`.

- `origens-padrao.png`: em Configurações › Regras da clínica, o bloco "Origens dos pacientes" está
  "Em uso" e já vem com a lista padrão (WhatsApp, Instagram: influenciador, Instagram: anúncio pago,
  Indicação de paciente, Encaminhamento médico, Outra), gravada na primeira leitura.
- `origem-nova.png`: o administrador acrescentou uma origem do tipo "Outra" pela linha "Nova origem", e ela
  continua na lista depois de recarregar. O tipo das origens existentes aparece fixo (não muda depois de
  criado); tirar da lista é desmarcar "Na lista".

Pelas rotas que a ficha e o relatório vão chamar, com a sessão do navegador, a mesma spec provou: o
contato que chegou pelo WhatsApp aparece como "WhatsApp" automático; encaminhamento sem o médico é
recusado (422) e com o médico é gravado; ninguém indica a si mesmo; a indicada mostra quem indicou; o
relatório do mês põe o médico com 1 paciente novo e 1 que comprou pacote; o perfil Somente leitura lê a
origem, mas recebe 403 ao registrar e ao abrir o relatório.
