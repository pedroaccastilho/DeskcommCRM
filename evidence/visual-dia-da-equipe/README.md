# evidence/visual-dia-da-equipe/ — a visão Equipe da Agenda (fork TOQ)

Prova pela tela do PR que acrescenta a visão Equipe: o dia com uma coluna por profissional
e os números do dia acima da grade. Supabase local com o `baseline.sql` e a clínica
fictícia do projeto TOQ (nenhum dado real), login da recepção, cores por modalidade
ligadas, sexta-feira 2 de outubro com 17 atendimentos semeados.

| Imagem | O que mostra |
|---|---|
| `evidence/visual-dia-da-equipe/dia-light.png` | Antes: a visão Dia com os mesmos 17 atendimentos numa coluna só, espremidos lado a lado. |
| `evidence/visual-dia-da-equipe/equipe-light.png` | Depois: uma coluna por profissional, com nome, modalidades e quantidade, e os números do dia acima da grade. |
| `evidence/visual-dia-da-equipe/equipe-dark.png` | O mesmo no tema escuro. |
| `evidence/visual-dia-da-equipe/equipe-celular.png` | No celular (390px), as colunas guardam uma largura legível e a grade rola para o lado com a hora fixa. |
| `evidence/visual-dia-da-equipe/e2e-equipe.png` | A captura que a spec `tests/e2e/clinica-agenda-cores.spec.ts` tira no banco do e2e. |
