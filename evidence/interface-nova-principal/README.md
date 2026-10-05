# A interface nova como a principal da equipe (migration 9010)

Prova pela tela, num Postgres com o `baseline.sql` e o módulo clínica instalado, com `next build` +
`next start` (produção). Contas de teste da clínica de demonstração: `gestao@` (Administrador) e
`recepcao@` (Recepção).

## O que foi feito na tela e o que se viu

| Passo | Resultado medido |
| --- | --- |
| Recepção entra com a chave **desligada** (o padrão) | fica em `/app/inbox`; o link antigo da ficha abre `/app/contacts/<id>` |
| Administrador abre o menu da interface atual | vê a porta "Abrir a interface nova" (`1-admin-menu-da-atual.png`) |
| Administrador, na nova, abre o menu da pessoa | chave "A equipe usa só a interface nova" desligada (`2-admin-chave-desligada.png`) |
| Liga a chave | `PUT /api/v1/clinica/interface` 200, chave ligada, ainda vê "Voltar para a versão atual" (`3-admin-chave-ligada.png`); `/app/contacts` continua na atual para ele |
| Recepção entra com a chave **ligada** | cai em `/novo` |
| Recepção abre o link antigo da ficha | levada a `/novo/pacientes/<id>` (`4-recepcao-link-antigo-da-ficha.png`) |
| Recepção abre `/app/agenda` | levada a `/novo/agenda` |
| Menu da pessoa da recepção | sem a chave e sem "Voltar para a versão atual" (`5-recepcao-menu-sem-voltar.png`) |
| Recepção tenta desligar pela API | **403** |
| Recepção abre `/app/settings` (sem equivalente na nova) | continua na atual |
| Administrador no celular, tema escuro, desliga | `PUT` 200, chave desligada (`6-celular-escuro-chave.png`) |

Auditoria: duas linhas `clinica.interface_principal_definida` (`{"nova_principal": true}` e
`{"nova_principal": false}`), no nome do Administrador.

## Gates

- `pnpm typecheck`, `pnpm lint` (arquivos tocados) e as cercas: verdes.
- `pnpm test:db` com `clinica-interface-principal`, `clinica-provisionadora`,
  `hardening-definer-varredura` e `clinica-etapas-da-sessao`: 26/26.
- `lib/novo/raiz.test.ts` confere que toda tela da nova para onde a atual leva tem página.
