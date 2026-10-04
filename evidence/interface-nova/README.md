# Interface nova em /novo (módulo clínica, teste A/B)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado, o módulo clínica instalado e o app
em `next build` + `next start`. Clínica de demonstração com dados fictícios; as sessões de hoje são
semeadas relativas à hora da captura. Telas em 1440 px (computador) e 390 px (celular).

- `recepcao-hoje.png`: a recepção abre em Hoje, com a linha do dia, o próximo paciente em destaque, o dia
  em listas curtas (em atendimento, falta registrar, sem confirmação, confirmados) e, ao lado, conversas
  esperando, renovação de pacote e multas.
- `recepcao-folha-da-sessao.png`: tocar num horário abre a folha com a ação que cabe agora (confirmar
  presença), remarcar, WhatsApp, a ficha e o cancelamento.
- `recepcao-agendar.png`: agendar em três passos (paciente, atendimento com o profissional, dia e horário).
- `gestao-hoje.png`: a gestão vê a clínica inteira e filtra por profissional.
- `gestao-agenda.png`: a agenda do dia com uma coluna por profissional e os blocos na cor da modalidade.
- `gestao-menu-ver-como.png`: o menu da pessoa, com "ver a tela de" outro cargo e a volta para a versão atual.
- `fisio-meu-dia.png`: o fisioterapeuta abre em Meu dia, só com as próprias sessões e as evoluções a escrever.
- `fisio-ficha-com-prontuario.png`: a ficha com os números do paciente, o pacote em barrinhas e o
  prontuário completo em linha do tempo (todas as áreas).
- `fisio-escrever-evolucao.png`: a evolução com a régua de dor de 0 a 10 de tocar.
- `celular-hoje.png`, `celular-folha-da-sessao.png`, `celular-pacientes.png`: as mesmas telas no
  celular, com a barra de abas embaixo e a folha subindo de baixo.
