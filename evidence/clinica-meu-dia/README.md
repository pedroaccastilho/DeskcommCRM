# Meu dia do profissional (módulo clínica)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-meu-dia.spec.ts`.

- `modo-atendimento.png`: o fisioterapeuta abre o Meu dia e o paciente da vez aparece em modo
  atendimento, com a última sessão (dor 6, conduta e plano) à esquerda e a evolução já vinculada à
  sessão à direita.
- `evolucao-pronta.png`: depois de "Compareceu", um toque em "Repetir a conduta" traz a conduta e o
  plano da última sessão, e a dor 3 foi escolhida na escala de 0 a 10.
- `meu-dia-celular.png`: em 390 px, a lista e o atendimento empilham sem rolagem lateral, com a
  evolução da sessão já assinada.
