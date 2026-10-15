# Painel financeiro na interface nova

Capturas da spec `tests/e2e/clinica-financeiro.spec.ts`, num banco fresco (`baseline.sql`), com o módulo clínica instalado, como o Administrador.

| Captura                  | O que mostra                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `1-a-cobrar.png`         | A porta "Financeiro" e a lista A cobrar: pacote, sessão avulsa e multa do paciente, cada um com o valor |
| `2-entradas.png`         | Depois de registrar o pagamento do pacote ali mesmo: ele sai de A cobrar e aparece em Entradas (Pix)  |
| `3-registrar-saida.png`  | A folha "Registrar saída": descrição, categoria, forma e valor                                       |
| `4-saidas.png`           | A saída lançada (aluguel, boleto) e o saldo do período ficando negativo                               |
| `5-notebook-720.png`     | Numa janela de 720 px de altura, o trilho aperta os itens e o avatar continua dentro da tela          |
| `6-celular.png`          | No celular: sem rolagem lateral; Financeiro fica no menu de "Você"                                    |
