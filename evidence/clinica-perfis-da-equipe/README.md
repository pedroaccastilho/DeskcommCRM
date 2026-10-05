# Perfis da equipe escolhidos no cadastro (módulo clínica)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-perfis-da-equipe.spec.ts`.

- `somar-perfis.png`: na tela Equipe do `/novo`, o administrador soma Gerente e Fisioterapeuta numa
  pessoa que já é da equipe; o perfil de saúde pede o registro no CREFITO na mesma folha.
- `equipe-com-perfis.png`: a lista mostra os dois perfis da pessoa depois de salvar.
- `cadastrar-pessoa.png`: o administrador cadastra uma pessoa nova com Jurídico, Financeiro e Gerente.
- `convite-pronto.png`: sem e-mail configurado, a tela entrega o link do convite para mandar pelo WhatsApp.
- `convidado-entrou-com-perfis.png`: a pessoa aceita o convite e entra já com os três perfis.
