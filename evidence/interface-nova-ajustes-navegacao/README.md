# Navegação automática das telas do administrador fica na interface nova

Continuação de `evidence/interface-nova-ajustes-detalhes/`. Build de produção com o `baseline.sql` e
o módulo clínica, conta `gestao@` (Administrador).

| Passo | Resultado medido |
| --- | --- |
| Abre `/ajustes/campanhas/nova` (`1-nova-campanha-na-interface-nova.png`) | a tela de lá, na casca nova |
| Clica em "Cancelar" (o botão chama `router.push("/app/campaigns")`, não é link) | vai para `/ajustes/campanhas`, na casca nova (`2-cancelar-volta-para-campanhas-na-nova.png`) |
| Controle: o mesmo "Cancelar" em `/app/campaigns/new` | continua indo para `/app/campaigns` (`3-controle-versao-atual-continua-la.png`) |
| Erros no navegador | nenhum |

O #56 desviava só os cliques em links. Botões que chamam `router.push`/`router.replace` (há 19 no
código de lá, como salvar um agente, salvar uma campanha ou abrir a conversa de um contato) seguiam
para a versão atual. A `CascaDoAjuste` agora entrega às telas de lá um roteador que traduz o
endereço por `enderecoNaInterfaceNova` antes de navegar; quem não tem par segue igual.

Gates: `components/novo/CascaDoAjuste.test.tsx` (push, replace, endereço sem par e clique em link;
sem o roteador traduzido, 5 dos 6 casos reprovam), `pnpm typecheck`, lint, cercas e `pnpm test:unit`.
