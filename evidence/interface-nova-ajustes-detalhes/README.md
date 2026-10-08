# Telas de detalhe do administrador dentro da interface nova

Continuação de `evidence/interface-nova-ajustes-todas/`. Build de produção com o `baseline.sql` e o
módulo clínica, conta `gestao@` (Administrador).

| Passo | Resultado medido |
| --- | --- |
| Em `/ajustes/funis`, clica no funil "Pedidos" (o link de lá aponta para `/app/pipelines/<id>`) | abre `/ajustes/funis/<id>`, com o quadro na casca nova (`1-quadro-do-funil.png`) |
| Em `/ajustes/ia/agentes`, clica em "Novo agente" (`/app/ai/agents/new`) | abre `/ajustes/ia/agentes/novo` (`2-novo-agente.png`) |
| Em `/ajustes/campanhas`, clica em "Nova campanha" (`/app/campaigns/new`) | abre `/ajustes/campanhas/nova` (`3-nova-campanha.png`) |
| Ctrl+clique no funil | a aba atual fica em `/ajustes/funis`, e o navegador abre `/app/pipelines/<id>` em outra aba, como sempre |
| Erros no navegador nas telas acima | nenhum |

As telas de detalhe da versão atual (`DETALHES_NA_INTERFACE_NOVA` em `lib/novo/ajustes.ts`) ganharam
página aqui. Um clique num link de lá que tenha par aqui fica na interface nova, pela
`CascaDoAjuste`. O que não tem par continua indo para a versão atual.

Gates: `lib/novo/ajustes.test.ts` (cada detalhe tem página que monta a de lá, e os links levam ao
par com o id e a busca), `pnpm typecheck`, lint dos arquivos tocados, cercas e `pnpm test:unit`.
