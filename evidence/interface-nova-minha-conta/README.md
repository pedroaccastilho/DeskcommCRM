# Minha conta na interface nova (perfil, segurança, avisos)

Prova pela tela, num Postgres com o `baseline.sql` e o módulo clínica instalado, com `next build` +
`next start` (produção). Conta de teste `recepcao@` (Recepção) da clínica de demonstração, com a
chave "A equipe usa só a interface nova" ligada durante o caso e devolvida ao valor anterior no fim
(o nome alterado também voltou).

| Passo | Resultado medido |
| --- | --- |
| Recepção abre o menu da pessoa e toca em "Minha conta" | abre `/conta`, com o perfil (`1-recepcao-perfil.png`) |
| Troca o nome e salva | aviso "Perfil atualizado."; no banco, `full_name` = "Carla Recepção" |
| Toca na aba Segurança | abre `/conta/seguranca`, aba marcada (`2-recepcao-seguranca.png`) |
| Toca na aba Avisos | abre `/conta/avisos` (`3-recepcao-avisos.png`) |
| Abre `/app/settings/profile`, `/app/settings/security`, `/app/settings/notifications` | levada a `/conta`, `/conta/seguranca`, `/conta/avisos` |
| Celular, tema escuro, Segurança | cartão com o fundo do tema escuro da interface nova, `rgb(27, 36, 32)` (`4-celular-escuro-seguranca.png`) |

Os formulários são os mesmos da versão atual (mesmas ações de servidor). Troca de senha continua
pelo "Esqueci minha senha" do login, como na versão atual, que também não tem outra.

## Gates

- `pnpm typecheck`, `pnpm lint` (arquivos tocados), cercas e `pnpm test:unit` inteiro.
- `lib/novo/raiz.test.ts`: as três telas da conta levam para a nova, e o destino tem página.
