# Chegou e em atendimento (módulo clínica)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-chegou.spec.ts`.

- `balcao-na-recepcao.png`: a recepção tocou "Chegou" no Balcão. O paciente passa para "Na
  recepção", com a hora da chegada no painel, e entra no filtro "Na clínica".
- `meu-dia-em-atendimento.png`: o profissional viu no Meu dia que o paciente estava na recepção e
  tocou "Iniciar atendimento". A tela mostra desde quando o atendimento começou, e "Compareceu"
  passa a ser o botão principal.
