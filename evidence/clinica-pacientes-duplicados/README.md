# Pacientes duplicados na interface nova

Spec: `tests/e2e/clinica-pacientes-duplicados.spec.ts` (banco local do baseline, `next build` + `next start`).

| Foto | O que prova |
|---|---|
| `1-pacientes-com-duplicados.png` | A tela Pacientes do administrador tem o botão "Duplicados" ao lado de "+ Novo paciente" |
| `2-dois-cadastros-lado-a-lado.png` | O mesmo celular com e sem o nono dígito aparece como um grupo, com a escolha de quem fica |
| `3-confirmacao.png` | Juntar pede confirmação nomeando quem fica e quem é absorvido |
| `4-depois-de-juntar.png` | Depois de juntar, o grupo some e não há mais duplicados |
| `5-celular.png` | No celular, os dois botões cabem na largura |
