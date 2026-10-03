# Pacotes de sessões (migration 9004)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-pacotes.spec.ts`.

- `catalogo.png`: em Configurações › Regras da clínica, o bloco "Pacotes" está "Em uso", as
  reposições seguem "Guardado para depois", e o administrador cadastrou em "Pacotes à venda" o pacote
  "Fisioterapia 10 sessões" de R$ 1.200,00, que continua lá depois de recarregar. A linha "Novo
  pacote" aceita valor em branco ("Sem preço").
- `multa-pelo-pacote.png`: o paciente comprou o pacote (venda com aceite da política; a mesma
  `Idempotency-Key` devolveu o mesmo pacote). "Compareceu" numa sessão passada baixou o saldo de 10
  para 9. Cancelar uma sessão daqui a 3 horas gerou a multa de R$ 36,00: 30% de R$ 120,00, o valor
  da sessão no pacote (R$ 1.200 / 10), e não dos R$ 150,00 do preço avulso do tipo. O cancelamento
  não gastou sessão (saldo segue 9). Congelar por 10 dias andou a validade 10 dias, e a segunda vez
  foi recusada (409). O perfil Somente leitura recebe 403 na lista de pacotes e no catálogo.
