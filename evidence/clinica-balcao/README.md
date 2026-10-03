# Balcão da recepção (módulo clínica)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-balcao.spec.ts`.

- `balcao.png`: a recepção abre o Balcão pelo menu e vê a fila do dia com os filtros por situação.
- `dentro-da-tolerancia.png`: a falta de Bruno foi registrada depois da tolerância. Carla, atrasada
  5 minutos, ainda não pode receber falta: o painel diz a partir de que horas, e a ação principal é remarcar.
- `cancelar-com-multa.png`: ao cancelar em cima da hora pelo paciente, a janela mostra a multa de 30%
  (R$ 45,00 sobre a sessão de R$ 150,00) antes do clique.
- `whatsapp.png`: a janela do WhatsApp abre com o lembrete pronto, sem sair do Balcão.
- `balcao-celular.png`: em 390 px, a fila e o painel empilham sem rolagem lateral.
