# Interface nova: Relatórios da gestão e exportação para a contabilidade

Prova pela tela, com `next build` + `next start`, Supabase local com o `baseline.sql` e a migration 9009
aplicada, e os usuários de demonstração. Dirigido por Playwright (Chromium), em 2026-10-04.

| Arquivo | O que mostra |
|---|---|
| `gestao-este-mes.png` | Administrador abre **Relatórios** pelo menu; indicadores do mês corrente. |
| `gestao-90-dias.png` | "Últimos 90 dias": por profissional, por modalidade, dinheiro do período, origem dos pacientes novos e exportação. |
| `exportar.png` | Os quatro botões de exportação. |
| `escuro-datas-escolhidas.png` | Modo escuro com período escolhido (01/09 a 31/10). |
| `gerente-fisio-celular-meu-dia.png` | Gerente que também é fisioterapeuta, no celular: está no "Meu dia" e o menu soma **Relatórios** (as abas cabem: `scrollWidth 366 = clientWidth 366`, página 390 px sem rolagem lateral). |
| `gerente-fisio-celular-relatorios.png` | A mesma pessoa abrindo os relatórios no celular. |
| `recepcao-sem-acesso.png` | Recepção digitando a URL: sem menu e sem dados; a exportação responde **403**. |
| `clinica-*.csv` | As planilhas baixadas pelo botão (90 dias): BOM UTF-8, `;`, vírgula decimal, data `dd/mm/aaaa`. |

Medido no mesmo roteiro:

- Menu do administrador: `Hoje | Agenda | Pacientes | WhatsApp | Relatórios | Ajustes`.
- Menu da recepção: `Hoje | Agenda | Pacientes | WhatsApp` (sem Relatórios).
- Perfis Jurídico + Enfermeiro (papel `manager`): menu sem Relatórios, e
  `GET /api/v1/clinica/relatorios/gestao` → `403 forbidden` "Os relatórios da gestão são para
  Administrador, Gerente e Financeiro."
- Cada CSV abriu com BOM (`bom=true`); o resumo tem 19 linhas, sessões 21, pacotes 4, multas 3.

Os números batem com `fn_clinica_relatorio_gestao` consultada direto no banco no mesmo período, e
o invariante `tests/invariants/clinica-relatorio-gestao.test.ts` prova as contas com dados fixos e
o isolamento entre duas clínicas.
