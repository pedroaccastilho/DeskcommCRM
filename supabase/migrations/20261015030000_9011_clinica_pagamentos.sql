-- 9011 — Clínica: o pagamento registrado (pacote, sessão avulsa e multa) e a multa por falta.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (2026-10-15): "senti falta de ter algum lugar pra dizer se o aluno já pagou ou
-- não, e qual foi a forma de pagamento. Isso tbm inclui se ele pagou tanto o pacote que fechou,
-- quanto a consulta avulsa, bem como tbm a multa. [...] indicar quando o aluno faltou, se iremos
-- cobrar a multa ou não".
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_pagamentos`: um pagamento registrado À MÃO pela recepção (sem maquininha nem banco,
--    que é roadmap). Paga UMA coisa: um pacote, uma sessão avulsa ou uma multa — três chaves
--    estrangeiras tipadas, exatamente uma preenchida (não é polimórfico por texto). Um pagamento
--    por coisa (índices únicos parciais): registrar de novo é 23505, e desfazer apaga a linha
--    (a auditoria guarda o que foi desfeito).
-- 2. `clinica_multas.origem`: 'cancelamento' (a de sempre, padrão para as linhas que já existem)
--    ou 'falta' — a multa que a recepção decide cobrar ao marcar "Faltou". O valor segue a mesma
--    política da multa de cancelamento (percentual sobre o valor da sessão).
--
-- A multa paga continua com `status = 'paga'` (o valor já existia no CHECK da 9002): o
-- relatório da gestão conta "a receber" só com as pendentes, e segue certo sem mudança.
--
-- ── Como entra ──────────────────────────────────────────────────────────────────────────────
-- Provisionadora nova `fn_clinica_provisionar_pagamentos()`, chamada no fim de
-- `fn_clinica_provisionar_interface()` (9010), recriada aqui com o corpo em vigor e essa linha a
-- mais: é a folha da cadeia. Quando ela roda, multas (agenda) e pacotes já existem. Onde o módulo
-- já está instalado, o bloco `do` do fim aplica na hora.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabela, coluna e funções do módulo. Sem o módulo, nada existe e nada muda.

-- ---- a provisionadora dos pagamentos ----
create or replace function public.fn_clinica_provisionar_pagamentos()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── de onde veio a multa ──────────────────────────────────────────────────
  alter table public.clinica_multas
    add column if not exists origem text not null default 'cancelamento';
  alter table public.clinica_multas
    drop constraint if exists clinica_multas_origem_valida;
  alter table public.clinica_multas
    add constraint clinica_multas_origem_valida check (origem in ('cancelamento', 'falta'));
  comment on column public.clinica_multas.origem is
    'cancelamento = cancelou em cima da hora (automática); falta = a recepção decidiu cobrar ao registrar a falta (9011).';

  -- ── o pagamento registrado ────────────────────────────────────────────────
  create table if not exists public.clinica_pagamentos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `restrict`: pagamento é registro financeiro do paciente; a LGPD anonimiza, não apaga.
    contact_id uuid not null references public.contacts(id) on delete restrict,
    -- O que foi pago: exatamente um dos três.
    pacote_id uuid references public.clinica_pacotes(id) on delete cascade,
    appointment_id uuid references public.calendar_appointments(id) on delete cascade,
    multa_id uuid references public.clinica_multas(id) on delete cascade,
    forma text not null
      check (forma in ('pix', 'cartao_credito', 'cartao_debito', 'dinheiro')),
    -- NULL quando a coisa paga não tem valor cadastrado (pacote ou tipo sem preço).
    valor_cents bigint check (valor_cents is null or valor_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    pago_em timestamptz not null default now(),
    registrado_por_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    constraint clinica_pagamentos_paga_uma_coisa check (
      num_nonnulls(pacote_id, appointment_id, multa_id) = 1
    )
  );

  create unique index if not exists clinica_pagamentos_um_por_pacote
    on public.clinica_pagamentos (pacote_id) where pacote_id is not null;
  create unique index if not exists clinica_pagamentos_um_por_sessao
    on public.clinica_pagamentos (appointment_id) where appointment_id is not null;
  create unique index if not exists clinica_pagamentos_um_por_multa
    on public.clinica_pagamentos (multa_id) where multa_id is not null;
  create index if not exists clinica_pagamentos_paciente_idx
    on public.clinica_pagamentos (organization_id, contact_id, pago_em desc);

  -- ── RLS ───────────────────────────────────────────────────────────────────
  -- Valor é financeiro: `agent`+ lê (como multa e pacote); "Somente leitura" não. Sem policy de
  -- escrita: só o servidor, depois de conferir o perfil (`lib/clinica/pagamentos.ts`).
  alter table public.clinica_pagamentos enable row level security;
  drop policy if exists clinica_pagamentos_select on public.clinica_pagamentos;
  create policy clinica_pagamentos_select
    on public.clinica_pagamentos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'agent'));
  revoke all on public.clinica_pagamentos from anon;

  comment on table public.clinica_pagamentos is
    'Pagamento registrado à mão pela recepção: de um pacote, de uma sessão avulsa ou de uma multa (exatamente um), com a forma (Pix, crédito, débito, dinheiro). Um por coisa paga. Só o servidor escreve, pela rota /api/v1/clinica/pagamentos.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_pagamentos() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_pagamentos() to service_role;

-- ---- a provisionadora da interface passa a chamar a dos pagamentos (9011) ----
-- O corpo é o da 9010, sem mudança, mais a última linha. Idempotente como antes.
create or replace function public.fn_clinica_provisionar_interface()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  alter table public.clinica_politicas
    add column if not exists interface_nova_principal boolean not null default false;
  comment on column public.clinica_politicas.interface_nova_principal is
    'Ligada, quem não é Administrador trabalha só na interface nova: as telas da atual que têm equivalente levam para ela. Só o Administrador muda (rota /api/v1/clinica/interface).';

  -- O pagamento registrado e a multa por falta (migration 9011).
  perform public.fn_clinica_provisionar_pagamentos();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_interface() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_interface() to service_role;

-- ---- onde o módulo já está instalado ----
do $do$
begin
  if to_regclass('public.clinica_multas') is not null
     and to_regclass('public.clinica_pacotes') is not null then
    perform public.fn_clinica_provisionar_pagamentos();
  end if;
end;
$do$;
