# Pacotes na ficha da interface nova (/novo): vender, congelar, prorrogar e cancelar

Capturas tiradas pelo navegador (Playwright), com `next build` + `next start`, banco local do
`baseline.sql` e dados de demonstração fictícios (@toq.demo).

| Captura | O que mostra |
| --- | --- |
| `vender-pacote.png` | A Recepção vende o pacote padrão de Pilates. "Confirmar venda" só liga depois de marcar que o paciente leu e aceitou a política de cancelamento (lida das Regras da clínica: 24 h, multa de 30%, 15 min de tolerância). |
| `congelar-pacote.png` | A Recepção congela o pacote por 15 dias, com o motivo. |
| `ficha-pacote-congelado.png` | A ficha com "Restam 10 de 10 sessões", a validade empurrada pelo congelamento e "Congelado até". |
| `escuro-celular-gestao-ajustes.png` | A Gerência, no celular e no modo escuro, vê "Prorrogar" e "Cancelar pacote"; a Recepção não vê esses dois. |

O que o navegador conferiu (saída do roteiro):

```
antes: Pacotes | + Vender pacote | Nenhum pacote vendido para este paciente.
confirmar sem aceite desabilitado: true
depois da venda: Pilates — 10 sessões | 0/10 | Restam 10 de 10 sessões | Vale até 3 de dezembro. | Congelar
recepção vê botões: [ '+ Vender pacote', 'Congelar' ]
depois de congelar: ... Vale até 18 de dezembro. Congelado até 19 de outubro.
gestão vê botões: [ '+ Vender pacote', 'Prorrogar', 'Cancelar pacote' ]
```
