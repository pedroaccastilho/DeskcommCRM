# evidence/visual-ficha-com-resumo/ — o resumo no topo da ficha do paciente (fork TOQ)

Prova pela tela do PR que abre a ficha do paciente pelo resumo: modalidades, equipe e os
cartões de próxima sessão, reavaliação e últimos 60 dias. Supabase local com o
`baseline.sql` e a clínica fictícia do projeto TOQ (nenhum dado real), módulo clínica
instalado, paciente fictícia Ana Beatriz Ferreira com oito sessões semeadas.

| Imagem | O que mostra |
|---|---|
| `evidence/visual-ficha-com-resumo/antes.png` | Antes, na mesma paciente (login da gestão): só os dados de contato e as etiquetas. Para saber a próxima sessão era preciso ir à Agenda. |
| `evidence/visual-ficha-com-resumo/depois-light.png` | Depois (login da recepção): modalidades, equipe e os três cartões acima das abas. |
| `evidence/visual-ficha-com-resumo/depois-dark.png` | O mesmo no tema escuro. |
| `evidence/visual-ficha-com-resumo/depois-celular.png` | No celular (390px), os cartões se empilham. |
| `evidence/visual-ficha-com-resumo/e2e-resumo.png` | A captura que a spec `tests/e2e/clinica-ficha-resumo.spec.ts` tira no banco do e2e. |
