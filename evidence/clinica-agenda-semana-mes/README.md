# Semana e Mês na agenda da interface nova

Spec: `tests/e2e/clinica-agenda-semana-mes.spec.ts` (banco local do baseline, `next build` + `next start`).

| Foto | O que prova |
|---|---|
| `1-semana.png` | Semana de segunda a domingo, com a contagem por dia; duas sessões que se sobrepõem ficam lado a lado (medido pelas caixas, não a olho) |
| `2-mes.png` | Mês em calendário, com as sessões do dia; a visão continua depois de recarregar a página |
| `3-dia-aberto-pelo-mes.png` | Tocar no dia do Mês abre o Dia daquele dia |
| `4-mes-no-celular.png` | Mês no celular: cabe na largura e mostra quantas sessões há em cada dia |
