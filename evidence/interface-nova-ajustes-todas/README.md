# Todas as telas do administrador dentro da interface nova

Continuação de `evidence/interface-nova-ajustes/`. Prova num Postgres com o `baseline.sql` e o módulo
clínica instalado, com `next build` + `next start` (produção), conta `gestao@` (Administrador).

## O que se mediu

Para cada uma das 58 telas de `lib/novo/ajustes.ts`, abri a tela da versão atual e a da interface
nova, e comparei duas coisas: o status da página e as respostas com erro que a página recebeu.

- **50 telas: iguais nas duas.** Duas delas trazem um erro, igual nas duas versões, que vem desta
  máquina e não da troca. Conexões dá 502 porque não há WAHA de pé, e Honorários dá 500 em
  `/api/v1/honorarios/contratos`.
- **8 telas: "não existe" nas duas**, porque o módulo ou a capacidade está desligado nesta
  instalação. São empresas, pessoas, importações, propostas (três telas), fluxos de atendimento e
  dados externos. A versão atual responde 200 com a tela de "não encontrado", porque o layout de
  `/app` já começou a responder. A nova responde 404 com a mesma tela. Quem recusa nas duas é o
  layout da tela de lá, que a página da nova monta. Com o módulo desligado, o `/ajustes` nem lista
  essas telas.
- Celular de 390 px no tema escuro: sem rolagem lateral (`scrollWidth` = 390).

Capturas: `1-funis.png`, `2-campanhas.png`, `3-ia-agentes.png`, `4-ia-provedores.png`,
`5-desempenho.png`, `6-recursos-opcionais.png`, `7-celular-escuro-funis.png`,
`8-celular-escuro-follow-ups.png`.

## O que ainda abre na versão atual

As telas de detalhe que essas listas abrem continuam na versão atual: o quadro de um funil, um
lead, uma campanha, um agente, um follow-up e outras parecidas. O link delas mora no componente da
versão atual, e trocar isso é o passo seguinte.

## Gates

- `lib/novo/ajustes.test.ts` cobra três coisas. Toda tela do catálogo de navegação tem endereço na
  nova. Cada página migrada monta a página da atual. E monta também os layouts do caminho de lá.
  A última regra foi sabotada: sem o layout de `/app/companies`, o teste reprova.
- `pnpm typecheck`, `pnpm lint` (arquivos tocados), cercas e `pnpm test:unit` inteiro.
