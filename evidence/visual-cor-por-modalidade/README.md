# evidence/visual-cor-por-modalidade/ — Agenda com cores por modalidade (fork TOQ)

Prova pela tela do PR que pinta a grade da Agenda pela modalidade do módulo clínica.
Supabase local com o `baseline.sql`, a clínica fictícia de `docs/` do projeto TOQ
(nenhum dado real) e login da recepção, 1440×900.

| Imagem | O que mostra |
|---|---|
| `evidence/visual-cor-por-modalidade/agenda-semana-profissional-light.png` | Antes: cores por profissional (o alternador em "Profissional" desenha a grade como o núcleo). |
| `evidence/visual-cor-por-modalidade/agenda-semana-modalidade-light.png` | Depois: cores por modalidade, iniciais de quem atende e legenda. |
| `evidence/visual-cor-por-modalidade/agenda-semana-profissional-dark.png` | Antes, tema escuro. |
| `evidence/visual-cor-por-modalidade/agenda-semana-modalidade-dark.png` | Depois, tema escuro. |
| `evidence/visual-cor-por-modalidade/agenda-mes-modalidade-light.png` | Visão de mês com as cores por modalidade. |
| `evidence/visual-cor-por-modalidade/agenda-mes-modalidade-dark.png` | Visão de mês, tema escuro. |
| `evidence/visual-cor-por-modalidade/agenda-topo-light.png` | O alternador "Modalidade / Profissional" ao lado do filtro de pessoas. |
| `evidence/visual-cor-por-modalidade/agenda-topo-dark.png` | O alternador, tema escuro. |
| `evidence/visual-cor-por-modalidade/e2e-modalidade.png` | Gravada por `tests/e2e/clinica-agenda-cores.spec.ts` no passo da modalidade. |
