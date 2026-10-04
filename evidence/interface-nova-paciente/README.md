# Cadastro e edição de paciente na interface nova (/novo)

Capturas tiradas pelo navegador (Playwright), com `next build` + `next start`, banco local do
`baseline.sql` e dados de demonstração fictícios (@toq.demo), logado como Recepção.

| Captura | O que mostra |
| --- | --- |
| `cadastro-novo-paciente.png` | A folha "Novo paciente" preenchida: telefone com DDD, nascimento, origem "Indicação de paciente" e quem indicou escolhido pela busca. Antes de escolher quem indicou, o botão fica desligado e a folha diz o que falta. |
| `ficha-depois-do-cadastro.png` | Depois de cadastrar, a tela abre a ficha do paciente novo, com "Veio por Indicação de paciente · Ana Beatriz Ferreira". |
| `editar-cadastro.png` | "Editar" abre a mesma folha já com a origem gravada marcada; aqui ela vira "Instagram: influenciador", com o perfil, e ganha duas etiquetas. |
| `ficha-depois-de-editar.png` | A ficha mostra a origem nova e as etiquetas `#pilates` e `#coluna`. |
| `escuro-celular-lista.png` | Lista de pacientes no celular, modo escuro, com o botão "Novo paciente". |
| `escuro-celular-cadastro-telefone-errado.png` | Telefone incompleto: a folha avisa "DDD e número" no próprio campo, no modo escuro. |

O que o navegador conferiu (saída do roteiro):

```
botão desabilitado sem quem indicou: true
selos na ficha: Veio por Indicação de paciente · Ana Beatriz Ferreira
origem marcada ao abrir edição: Indicação de paciente
selos depois de editar: Veio por Instagram: influenciador · @movimento.saudavel #pilates #coluna
```
