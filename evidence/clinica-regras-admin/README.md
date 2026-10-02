# Regras da clínica, só do administrador (migration 9003)

Prova pela tela, num Supabase local com o `baseline.sql` aplicado e o app em `next build` + `next start`,
dirigida por `tests/e2e/clinica-regras.spec.ts`.

- `regras-padrao.png`: o administrador abre Configurações › Regras da clínica e encontra os padrões
  da TOQ (24 h, 30%, 15 min, pacote de 10 sessões em 60 dias, alertas). Pacotes e alertas aparecem
  como "Guardado para depois".
- `regras-salvas.png`: depois de mudar a multa para 40%, etiquetar o tipo "Sessão de fisioterapia E2E"
  como Fisioterapia e dar a ele o preço de R$ 150,00, tudo continua lá depois de recarregar. O preço
  foi gravado em `calendar_event_types.default_price_cents` (15000), o mesmo de Tipos de agendamento.
- `gerente-sem-a-porta.png`: o Gerente não vê "Regras da clínica" em Configurações, é devolvido se
  digitar o endereço e recebe 403 ao ler as regras ou mudar a modalidade. O perfil Somente leitura
  recebe 403 na lista de multas.
