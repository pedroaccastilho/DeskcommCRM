# Interface nova: WhatsApp dentro do layout novo

Banco local aplicado do `baseline.sql`, `next build` + `next start`, conversas fictícias semeadas
numa sessão de canal local. Capturas pelo Playwright com a conta da recepção.

| Arquivo | O que mostra |
|---|---|
| `claro-lista.png` / `escuro-lista.png` | Clique em "WhatsApp" no trilho abre `/novo/whatsapp`, com a fila |
| `claro-conversa.png` / `escuro-conversa.png` | Conversa aberta (`?id=` na URL), com a ficha do contato à direita |
| `claro-escrevendo.png` | Mensagem digitada no composer |
| `escuro-celular-lista.png` / `escuro-celular-conversa.png` | Celular, escuro: a conversa termina acima da barra de abas |

Medidas (`getBoundingClientRect`):

```
caixa (1440x900): {"top":16,"bottom":884,"h":868,"vh":900,"scroll":900}   ← sem rolagem da página
celular: campo termina em 728, abas começam em 758.5                      ← nada fica atrás das abas
fisio vê porta WhatsApp: 0                                                ← quem atende segue sem a porta
```

Achado e corrigido nesta entrega: a conversa selecionada usava `bg-accent-50`, um tom claro fixo
nos dois temas; no escuro o nome ficava branco sobre branco. Dentro da interface nova o token é
reapontado para um tom da cor de ação sobre o cartão.
