# Acabamento da interface nova

Spec: `tests/e2e/clinica-acabamento-visual.spec.ts` (banco local do baseline, `next build` + `next start`). A spec mede o alinhamento e a altura dos itens do menu, a separação das abas do celular e a largura de cada tela; as fotos são para quem revisa ver o conjunto.

| Foto | O que mostra |
|---|---|
| `0-antes-menu-torto.png` | Antes: "Minha agenda" e "Meus pacientes" quebravam linha encostados à esquerda e o item ativo crescia |
| `light-menu-lateral.png` | Depois, no claro: rótulos centralizados e todos os itens do menu com a mesma altura |
| `dark-menu-lateral.png` | O mesmo menu no escuro |
| `light-computador-agenda.png` | A Minha agenda com o menu novo |
| `dark-computador-hoje.png` | Meu dia no escuro, com as horas da linha do dia sem "19h20h" encavalado |
| `light-celular-hoje.png` | Meu dia no celular: horas separadas e abas com rótulos centralizados |
| `gestao-dark-abas-do-celular.png` | As seis abas da gestão no celular, sem um rótulo encostar no outro |
| `light-computador-whatsapp.png` | WhatsApp com a lista mais larga (a busca não corta mais) e as palavras separadas |
| `dark-computador-pacientes.png` | Pacientes no escuro: o botão "Duplicados" visível e as iniciais "CA" no paciente anonimizado |
| `gestao-dark-celular-ficha.png` | Ficha no celular, com o nome menor para caber |
