# A interface nova sem o /novo no endereço

Prova pela tela, num Postgres com o `baseline.sql` e o módulo clínica instalado, com `next build` +
`next start` (produção). Contas de teste da clínica de demonstração: `gestao@` (Administrador) e
`recepcao@` (Recepção). A chave "A equipe usa só a interface nova" foi ligada para o caso e
voltou ao valor anterior no fim.

## O que foi feito na tela e o que se viu

| Passo | Resultado medido |
| --- | --- |
| Sem sessão, abre `/agenda` | vai ao login com `next=/agenda` |
| Administrador abre o endereço antigo `/novo` | cai em `/hoje` (`1-admin-novo-vira-hoje.png`) |
| Trilho do menu | `/hoje`, `/agenda`, `/pacientes`, `/whatsapp`, `/relatorios`, `/equipe`: nenhum link com `/novo` |
| Administrador abre `/novo/pacientes/<id>` | cai em `/pacientes/<id>`, a mesma ficha (`2-admin-ficha-antiga-vira-pacientes.png`) |
| Administrador abre `/novo/whatsapp?id=<conversa>` | cai em `/whatsapp?id=<conversa>` |
| Administrador abre `/novo/equipe` | cai em `/equipe` |
| Clica em Agenda no menu | abre `/agenda`, e a porta Agenda fica marcada (`3-admin-agenda-pelo-menu.png`) |
| Recepção abre `/app`, `/app/tasks`, `/app/contacts/<id>` | cai em `/hoje`, `/tarefas`, `/pacientes/<id>` (`4-recepcao-celular-escuro-hoje.png`, no celular e no tema escuro) |
| Recepção abre `/app/inbox?id=<conversa>` | cai em `/whatsapp?id=<conversa>`, com a conversa aberta |

## Defeito achado e consertado

Antes deste PR, o último passo levava a `/whatsapp` **sem** a conversa: o `proxy.ts` punha o
cabeçalho `x-search` no pedido depois de criar o `NextResponse.next`, que copia os cabeçalhos no
momento em que é criado. Os cabeçalhos agora vão para o pedido antes, e a conversa chega.

## Gates

- `pnpm typecheck`, `pnpm lint` (arquivos tocados), cercas e `pnpm test:unit` inteiro: verdes
  (fora `pdf-extractor.test.ts`, que só falha nesta máquina).
- `lib/novo/rotas.test.ts`: toda tela tem página em `app/(nova)`, o menu de todo cargo só aponta
  para elas, e os redirecionamentos de `/novo` levam só às telas conhecidas.
- `tests/e2e/clinica-perfis-da-equipe.spec.ts` (agora em `/equipe`): verde.
