# Ajustes do administrador na interface nova

Prova pela tela, num Postgres com o `baseline.sql` e o módulo clínica instalado, com `next build` +
`next start` (produção). Contas de teste da clínica de demonstração: `gestao@` (Administrador) e
`recepcao@` (Recepção).

| Passo | Resultado medido |
| --- | --- |
| Administrador toca em "Ajustes" no trilho | abre `/ajustes` com 59 telas em seis grupos: 21 já abrem na interface nova, 38 marcadas "versão atual" (`1-ajustes.png`) |
| Busca "regras" | sobra só "Regras da clínica" (`2-busca-regras.png`) |
| Toca no cartão | abre `/ajustes/clinica/regras`, na casca nova, com os 38 campos da tela de regras (`3-regras-da-clinica.png`) |
| Abre as outras dez telas migradas | todas 200, na casca nova, com o título de cada uma: `4-empresa.png`, `4-clinica.png`, `4-clinica-chatbot.png`, `4-agenda.png`, `4-financeiro.png`, `4-marca.png`, `4-etiquetas.png`, `4-conexoes.png`, `4-auditoria.png`, `4-lgpd.png` |
| Celular, tema escuro | `5-celular-escuro-ajustes.png` e `6-celular-escuro-regras.png` |
| Recepção abre `/ajustes` | "Ajustes são do administrador"; a porta Ajustes não aparece para ela |
| Recepção abre `/ajustes/clinica/regras` | a própria página recusa e leva a `/app/settings`, como na versão atual |

O único erro no navegador foi um 502 em Conexões, da sonda do WhatsApp, porque não havia WAHA de
pé nesta máquina. A mesma sonda dá o mesmo 502 em `/app/connections`.

## Gates

- `pnpm typecheck`, `pnpm lint` (arquivos tocados), cercas e `pnpm test:unit` inteiro.
- `lib/novo/ajustes.test.ts`: cada tela migrada está no catálogo de navegação e tem página que
  monta a MESMA página da versão atual.
