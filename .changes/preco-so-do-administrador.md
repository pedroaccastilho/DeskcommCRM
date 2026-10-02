---
impacto: capacidade_nova
secao: alterado
titulo: O preço padrão do tipo de agendamento só o administrador muda
---
Em Configurações › Tipos de agendamento, o Gerente continua criando e alterando os tipos, mas o "Preço padrão" fica só para leitura, com o aviso "Só o administrador muda o preço.". A API recusa com 403 o preço enviado por quem não é administrador, ao criar ou ao alterar um tipo. O preço é a sugestão da comanda e, no módulo clínica, a base da multa de cancelamento.
