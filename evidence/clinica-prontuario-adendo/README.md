# Anamnese e adendo no prontuário da interface nova

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-prontuario-adendo.spec.ts`. Quem escreve é o administrador cadastrado como
fisioterapeuta, na visão "Profissional".

- `1-anamnese-assinada.png`: na ficha nova, "Escrever evolução" passou a oferecer a Anamnese, com os
  campos do conselho; ela foi assinada e aparece no prontuário com o botão "Adicionar adendo".
- `2-adendo-escrito.png`: o adendo abre na própria folha, mostrando a que registro ele se liga (tipo,
  área, dia e quem assinou), e só pede o texto da correção.
- `3-adendo-no-prontuario.png`: o adendo assinado entra no prontuário com "Adendo a um registro
  anterior"; o registro original continua igual, e o adendo não recebe outro adendo.
- `4-celular.png`: o prontuário com o adendo num celular (390 px de largura), sem rolagem lateral.

O teste também confere no banco a anamnese (tipo e conteúdo) e o adendo (`tipo = adendo`, `adendo_de`
apontando para a anamnese e o texto).
