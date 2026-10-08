# Balcão e Meu dia no Hoje da interface nova

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-hoje-chegada.spec.ts`. A mesma pessoa (admin com cargo de saúde) troca a
visão entre "Gestão" (faz o papel da recepção) e "Profissional" (quem atende).

- `1-folha-na-recepcao.png`: na visão da gestão, a recepção tocou "Chegou" na folha da sessão. O selo
  passa a "Na recepção", a folha mostra a hora da chegada e a linha do pacote, e "Desfazer chegada"
  aparece para corrigir um toque errado.
- `2-hoje-na-clinica.png`: o Hoje com a seção nova "Na clínica", onde o paciente que chegou sobe para
  o topo do dia.
- `3-folha-em-atendimento.png`: na visão de quem atende, a linha mostrou "Iniciar" e a folha passou a
  "Em atendimento", com a hora da chegada e do início; "Realizado" vira o botão principal.
- `4-evolucao-pronta.png`: a evolução mostra a última sessão do paciente (dor, conduta, plano), e
  "Repetir a conduta" preencheu a conduta antes de assinar.
- `5-proxima-sessao.png`: depois de assinar, "Qual o próximo passo?" levou à escolha da próxima
  sessão, que já abre daqui a uma semana (o dia sugerido rola para dentro da fileira sozinho).
- `6-proxima-marcada.png`: a próxima sessão marcada aparece no próprio passo, com "Marcar outra sessão".
- `7-celular.png`: o mesmo passo num celular (390 px de largura), sem rolagem lateral.

O teste também confere no banco a etapa gravada em `clinica_sessao_etapas`, a evolução assinada em
`prontuario_registros` (dor 3, conduta repetida) e a nova sessão, entre 5 e 8 dias à frente, com o mesmo
profissional e o mesmo tipo.
