# Interface nova: multas na ficha e sessões a confirmar

Banco local aplicado do `baseline.sql`, módulo clínica provisionado, `next build` + `next start`.
Dados fictícios. Capturas feitas pelo Playwright com as contas de demonstração.

| Arquivo | O que mostra |
|---|---|
| `hoje-a-confirmar.png` | Recepção na tela Hoje: painel "A confirmar nos próximos dias" com as sessões pendentes de amanhã e depois de amanhã |
| `folha-da-sessao-de-amanha.png` | "Abrir" no painel abre a folha da sessão de amanhã (confirmar ou lembrar) |
| `ficha-multas.png` | Ficha do paciente com uma multa pendente e outra já isenta, com o motivo |
| `isentar-multa.png` | Folha de isenção: o botão só libera com motivo de 3 letras ou mais |
| `escuro-celular-multas.png` | Gestão, modo escuro, celular: as duas multas isentas depois da ação |
| `escuro-celular-a-confirmar.png` | Gestão, modo escuro, celular: painel a confirmar |

Saída do roteiro:

```
confirmar vazio desabilitado: true
multas antes: Multas | 1 em aberto | seg., 28 de set. · 09:00 | Pendente | ... | Isentar multa | seg., 14 de set. · 15:30 | Isenta | ...
multas depois: ... | seg., 28 de set. · 09:00 | Isenta | ... | Motivo: Imprevisto no trabalho, aceito pela gerência
fisio vê painel a confirmar: 0
```

Depois das capturas, a lista de multas passou a ordenar pendentes primeiro e, dentro de cada grupo,
a sessão mais recente no topo (nas capturas a ordem vinha da API).
