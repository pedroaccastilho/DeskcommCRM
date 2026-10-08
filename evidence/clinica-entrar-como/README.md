# Administrador entra como outra pessoa da equipe (módulo clínica)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-entrar-como.spec.ts`.

- `vendo-como-fisioterapeuta.png`: o administrador entrou como uma fisioterapeuta pela tela Equipe. A
  interface mostra o dia dela ("Meu dia", "Minha agenda", "Meus pacientes"), sem a porta Equipe, com
  a faixa fixa dizendo de quem é a tela e o botão "Voltar para o administrador".
- `de-volta-ao-administrador.png`: depois de voltar, a tela Equipe do administrador, sem a faixa.
