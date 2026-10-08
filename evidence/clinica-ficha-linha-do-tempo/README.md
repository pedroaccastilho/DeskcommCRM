# Linha do tempo e LGPD na ficha da interface nova

Spec: `tests/e2e/clinica-ficha-linha-do-tempo.spec.ts` (banco local do baseline, `next build` + `next start`).

| Foto | O que prova |
|---|---|
| `1-linha-do-tempo.png` | "Linha do tempo" aberta na ficha nova, com a mudança de etapa do negócio do paciente; o cartão LGPD do Administrador ao lado |
| `2-dialogo-de-anonimizacao.png` | O mesmo diálogo de duas etapas da versão atual (justificativa, depois "ANONIMIZAR") |
| `3-anonimizado.png` | Depois de confirmar: o cartão diz "Este contato já foi anonimizado", e o banco tem `is_anonymized = true`, o nome "Cliente Anonimizado #N" e o telefone limpo |
