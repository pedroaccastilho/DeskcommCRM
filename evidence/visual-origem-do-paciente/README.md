# Origem do paciente na ficha, no cadastro e no relatório

Provado pela tela com uma clínica fictícia: a recepção (`recepcao@toq.demo`, perfil Atendente) e a gerência (`gestao@toq.demo`, Administrador), módulo clínica instalado e a lista padrão de origens. Os pacientes, médicos, influenciadores e anúncios são inventados. A origem de Daniel e de Juliana foi registrada pela tela; a dos outros pacientes entrou direto no banco, para o relatório ter o que contar.

| Captura | O que mostra |
|---|---|
| ![antes](antes-ficha.png) | Antes: a ficha sem nada sobre a origem do paciente. É a mesma tela com a linha nova retirada, que é o que a versão atual desenha. |
| ![sem origem](depois-ficha-sem-origem.png) | Depois, paciente sem origem: "Sem origem registrada." e o botão "Registrar origem". |
| ![busca](depois-indicacao-busca.png) | Indicação de paciente: a janela pede quem indicou e busca na lista de contatos. |
| ![indicado por](depois-ficha-indicado-por.png) | A ficha depois de salvar: "Chegou por Indicação de paciente. Indicado por Ana Beatriz Ferreira.", com o link para a ficha dela. |
| ![whatsapp](depois-ficha-whatsapp-automatico.png) | Quem chegou sozinho pelo WhatsApp aparece como "WhatsApp (automático)", e a recepção pode registrar outra. |
| ![cadastro pede](depois-cadastro-pede-medico.png) | "Novo contato" com encaminhamento médico e sem o médico: a tela pede o nome antes de criar. |
| ![cadastro](depois-cadastro.png) | O mesmo cadastro com o médico preenchido. O aviso some quando a origem muda. |
| ![encaminhamento](depois-ficha-encaminhamento.png) | A ficha do paciente recém-criado: "Chegou por Encaminhamento médico, Dr. Paulo Lima." |
| ![relatório](depois-relatorio.png) | O relatório do mês para a gerência: o total, cada origem com os novos, quantos compraram pacote, a conversão e o valor, e por baixo cada médico, influenciador ou anúncio. |
| ![relatório escuro](depois-relatorio-dark.png) | O mesmo relatório no tema escuro. |
| ![relatório celular](depois-relatorio-celular.png) | O relatório no celular, com 390 px e sem rolagem para o lado: cada número leva o próprio rótulo. |
| ![hub](depois-hub-analise.png) | A porta "Origem dos pacientes" em Análise, para a gerência. A recepção que digita o endereço vai para a página de acesso negado. |

Capturas da spec `tests/e2e/clinica-origem-na-tela.spec.ts`, que registra a indicação pela ficha, cria um contato encaminhado pelo "Novo contato", lê o médico no relatório pela gerência e confere que o perfil Somente leitura vê a origem sem poder mudar:

- ![e2e quem indicou](e2e-quem-indicou.png)
- ![e2e indicado por](e2e-indicado-por.png)
- ![e2e relatório](e2e-relatorio.png)
