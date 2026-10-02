# Sessão da clínica no painel do compromisso: multa e tolerância

Provado pela tela com a recepção de uma clínica fictícia (login `recepcao@toq.demo`), módulo clínica instalado e os tipos de atendimento etiquetados com modalidade. O painel abre pela Agenda, pelo link `?compromisso=`.

| Captura | O que mostra |
|---|---|
| ![antes](antes.png) | Antes: o painel do núcleo. Cancelar não avisava nada, e é assim que fica fora das sessões da clínica. |
| ![aviso claro](depois-aviso-light.png) | Sessão daqui a 3 horas: o aviso da multa de 30% vem antes do cancelamento, com a opção de dizer que foi a clínica que desmarcou. |
| ![aviso escuro](depois-aviso-dark.png) | O mesmo aviso no tema escuro. |
| ![aviso celular](depois-aviso-celular.png) | O mesmo aviso no celular, com 390 px. |
| ![multa clara](depois-multa-light.png) | Depois de cancelar: a multa pendente, com o valor calculado do preço da sessão e o botão de isentar. |
| ![multa escura](depois-multa-dark.png) | A multa no tema escuro. |
| ![tolerância](depois-tolerancia.png) | Sessão que começou há 5 minutos: "Faltou" travado e a hora em que a falta pode ser registrada. |

Capturas da spec `tests/e2e/clinica-cancelar-com-multa.spec.ts`, que cancela, isenta e confere a trava da falta:

- ![e2e aviso](e2e-aviso.png)
- ![e2e multa](e2e-multa.png)
- ![e2e tolerância](e2e-tolerancia.png)
