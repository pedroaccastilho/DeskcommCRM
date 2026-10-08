# A porta "Gestão" por perfil na interface nova

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-gestao-por-perfil.spec.ts`. A pessoa é o usuário `manager` do seed, com
os perfis trocados entre Financeiro, Jurídico e Gerente.

- `1-gestao-do-financeiro.png`: o Financeiro ganha a porta "Gestão" no menu, com Comandas, Faturamento e
  Financeiro, e nada de auditoria nem LGPD.
- `2-comandas-pela-gestao.png`: Comandas abre dentro da interface nova, com "‹ Gestão" para voltar.
- `3-gestao-do-juridico.png`: o Jurídico vê só a auditoria e a LGPD.
- `4-lgpd-do-juridico.png`: as solicitações LGPD abrem para o Jurídico (antes só para o Administrador).
- `5-ficha-do-juridico.png`: na ficha do paciente, o Jurídico vê "Quem abriu este prontuário" e nenhum
  conteúdo clínico.
- `6-celular.png`: no celular, a Gestão fica no menu da pessoa.

O teste também confere pelo servidor: o Financeiro e o Gerente recebem 403 na LGPD; o Jurídico recebe
403 no relatório com valores, 200 na LGPD e na trilha de acessos, e a leitura do prontuário de um
paciente que tem registro assinado volta vazia; o Gerente recebe 403 na trilha de acessos.
