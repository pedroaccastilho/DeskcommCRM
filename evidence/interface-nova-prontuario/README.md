# Plano de tratamento, PDF do prontuário e "quem abriu" na ficha da interface nova (/novo)

Capturas tiradas pelo navegador (Playwright), com `next build` + `next start`, banco local do
`baseline.sql` e dados de demonstração fictícios (@toq.demo). A avaliação de fisioterapia com
10 sessões, 2x por semana e reavaliação em 30 dias foi assinada pela sessão do fisioterapeuta, como
na tela; o gatilho do banco criou o plano.

| Captura | O que mostra |
| --- | --- |
| `fisio-ficha-com-plano.png` | O fisioterapeuta vê o prontuário com "Baixar PDF" e o cartão "Plano de tratamento": Sessão 1 de 10, 2x por semana, reavaliação prevista ainda sem horário. |
| `admin-quem-abriu.png` | O administrador vê "Quem abriu este prontuário", com cada leitura e o PDF baixado. |
| `escuro-celular-recepcao-plano.png` | A recepção, no celular e no modo escuro, vê o plano (para marcar as sessões), mas não o prontuário, o PDF nem a lista de acessos. |

O que o navegador conferiu (saída do roteiro):

```
fisio, plano: Plano de tratamento | Fisioterapia | Avaliado | Sessão 1 de 10 | 2x por semana · avaliado por Rafael Costa | Reavaliação prevista para 3 de novembro · ainda sem horário
fisio vê acessos: 0
PDF baixado: prontuario-2026-10-04.pdf 7272 bytes, começa com %PDF-
admin, acessos: Quem abriu este prontuário | ... | Rafael Costa | Dom., 4 de out. · 12:53 | ...
recepção vê plano: 1 | vê PDF: 0 | vê acessos: 0
```
