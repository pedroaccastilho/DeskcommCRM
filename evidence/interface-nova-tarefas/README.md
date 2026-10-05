# Interface nova: Tarefas

Banco local aplicado do `baseline.sql`, `next build` + `next start`, tarefas fictícias semeadas.
Capturas pelo Playwright (recepção no computador, gestão no celular em modo escuro).

| Arquivo | O que mostra |
|---|---|
| `hoje-painel.png` | Painel "Tarefas de hoje" na tela Hoje, com a tarefa atrasada e o paciente |
| `lista.png` | `/novo/tarefas`, aberta pelo menu "Você › Tarefas", agrupada por prazo |
| `nova-tarefa.png` | Folha de nova tarefa: prazo, prioridade e paciente buscado pelo nome |
| `concluindo.png` | O visto aparece no clique, antes da lista voltar do servidor |
| `escuro-celular-ficha.png` | Ficha do paciente com o cartão de tarefas dele |
| `escuro-celular-todas.png` | Filtro "Todas", com a tarefa concluída em "Encerradas" |

Saída do roteiro:

```
painel hoje: Tarefas de hoje | 1 | Ligar para a Ana sobre o exame de imagem | sáb., 3 de out. às 16:53 | Alta | AF | Ana Beatriz Ferreira | Ver todas as tarefas
menu tem Tarefas: 1
lista depois: ... Atrasadas | 1 | ... | Nos próximos 7 dias | 2 | Enviar recibo do pacote ao Daniel | seg., 5 de out. às 09:00 | Alta | DO | Daniel Okada | ...
depois de concluir, em aberto: 2
ficha do Daniel: Tarefas | + Tarefa | Enviar recibo do pacote ao Daniel | seg., 5 de out. às 09:00 | Alta
```

O campo de data aparece em formato americano nas capturas porque o navegador de teste está em
inglês; num navegador em português ele mostra dd/mm/aaaa.
