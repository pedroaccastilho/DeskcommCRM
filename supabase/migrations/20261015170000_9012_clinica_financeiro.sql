-- 9012 — Clínica: o painel financeiro (entradas, saídas e o que falta cobrar) e as despesas.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (2026-10-15): "Pra galera que tem acesso ao financeiro, eu preciso que eles
-- tenham acesso à um cockpit de entradas e saídas, pra eles saberem oq ainda precisa cobrar do
-- cliente, oq já entrou, etc…".
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_despesas`: uma SAÍDA do caixa registrada à mão (aluguel, salário, material,
--    imposto…), com a forma de pagamento. O CRM não registrava despesa nenhuma; sem ela o painel
--    só teria entradas. Leitura `manager`+ (é o caixa da clínica, não o do paciente); escrita só
--    do servidor, depois de conferir o perfil (Administrador, Gerente, Financeiro).
-- 2. `fn_clinica_financeiro_resumo(org, de, ate)` → jsonb com o que entrou (pagamentos de
--    `clinica_pagamentos`), o que saiu (`clinica_despesas`) e o que está a receber no período.
-- 3. `fn_clinica_financeiro_entradas` e `fn_clinica_financeiro_a_receber` (org, de, ate) → uma
--    linha por item, em ordem estável, para a lista da tela e para o CSV (a rota pagina com
--    `range`; o PostgREST corta em 1000 linhas sem avisar).
--
-- ── O que cada número quer dizer ────────────────────────────────────────────────────────────
-- Entrada = pagamento registrado com `pago_em` no período. Saída = despesa com `pago_em` no
-- período. A receber = o que foi vendido, atendido ou multado no período e ainda não foi pago:
--   · pacote ATIVO sem pagamento (data: `comprado_em`; valor: o do pacote);
--   · sessão avulsa REALIZADA sem pagamento, isto é, que não gastou pacote (data: o início;
--     valor: o preço de tabela do tipo) — a mesma "avulsa" do relatório da gestão (9009);
--   · multa PENDENTE (data: `created_at`; valor: o da multa). Isenta não se cobra.
-- Valor ausente (pacote ou tipo sem preço) entra na contagem e fica fora da soma, com o número
-- de itens sem valor ao lado, para a tela dizer e a soma não mentir.
--
-- ── Quem chama ──────────────────────────────────────────────────────────────────────────────
-- Só o servidor (service_role), com a organização da sessão: `security definer` e revogadas de
-- public, anon e authenticated. A rota exige Gerente para cima e o perfil de gestão
-- (`recusaDoRelatorio`). Todas em plpgsql: o corpo só é validado ao rodar, e as tabelas
-- `clinica_*` nascem só na provisionadora.
--
-- ── Como entra ──────────────────────────────────────────────────────────────────────────────
-- Provisionadora nova `fn_clinica_provisionar_despesas()`, chamada no fim de
-- `fn_clinica_provisionar_interface()` (9010/9011, recriada aqui com o corpo em vigor e essa linha
-- a mais), logo depois da dos pagamentos: é a folha da cadeia. Onde o módulo já está instalado, o bloco `do` do fim aplica na hora.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabela e funções do módulo. Sem o módulo, nada existe e a rota responde
-- `module_not_installed`.

-- ---- a provisionadora das despesas ----
create or replace function public.fn_clinica_provisionar_despesas()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.clinica_despesas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    descricao text not null check (length(btrim(descricao)) between 2 and 160),
    categoria text not null
      check (categoria in ('aluguel', 'pessoal', 'materiais', 'impostos', 'contas',
                           'marketing', 'manutencao', 'servicos', 'outros')),
    forma text not null
      check (forma in ('pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'boleto',
                       'transferencia')),
    valor_cents bigint not null check (valor_cents > 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    -- O dia em que saiu do caixa (a tela manda o dia; o servidor grava meio-dia de Brasília).
    pago_em timestamptz not null default now(),
    registrado_por_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now()
  );

  create index if not exists clinica_despesas_periodo_idx
    on public.clinica_despesas (organization_id, pago_em desc);

  -- ── RLS ───────────────────────────────────────────────────────────────────
  -- O caixa da clínica: `manager`+ lê. Sem policy de escrita: só o servidor, depois de conferir
  -- o perfil (`lib/clinica/financeiro.ts`).
  alter table public.clinica_despesas enable row level security;
  drop policy if exists clinica_despesas_select on public.clinica_despesas;
  create policy clinica_despesas_select
    on public.clinica_despesas
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'manager'));
  revoke all on public.clinica_despesas from anon;

  comment on table public.clinica_despesas is
    'Saída do caixa da clínica registrada à mão (aluguel, pessoal, materiais…), com a forma. Só o servidor escreve, pela rota /api/v1/clinica/despesas (9012).';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_despesas() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_despesas() to service_role;

-- ---- a provisionadora da interface passa a chamar também a das despesas (9012) ----
-- O corpo é o da 9011, sem mudança, mais a última linha. Idempotente como antes. (A dos
-- pagamentos não é recriada: o corpo dela reconstrói uma constraint, e uma constraint só pode
-- ser reconstruída em um bloco do baseline.)
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
  -- As saídas do caixa da clínica (migration 9012).
  perform public.fn_clinica_provisionar_despesas();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_interface() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_interface() to service_role;

-- ---- o resumo do painel financeiro ----
create or replace function public.fn_clinica_financeiro_resumo(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
declare
  v_entradas jsonb;
  v_saidas jsonb;
  v_receber jsonb;
begin
  with e as (
    select pg.forma,
           case when pg.pacote_id is not null then 'pacote'
                when pg.appointment_id is not null then 'sessao'
                else 'multa' end as tipo,
           pg.valor_cents
      from public.clinica_pagamentos pg
     where pg.organization_id = p_org
       and pg.pago_em >= p_de
       and pg.pago_em < p_ate
  )
  select jsonb_build_object(
    'qtd', (select count(*) from e),
    'total_cents', (select coalesce(sum(e.valor_cents), 0) from e),
    'sem_valor', (select count(*) from e where e.valor_cents is null),
    'por_forma', coalesce((
      select jsonb_agg(jsonb_build_object('forma', x.forma, 'qtd', x.qtd, 'valor_cents', x.valor)
                       order by x.valor desc, x.forma)
        from (select e.forma, count(*) as qtd, coalesce(sum(e.valor_cents), 0) as valor
                from e group by e.forma) x
    ), '[]'::jsonb),
    'por_tipo', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'qtd', x.qtd, 'valor_cents', x.valor)
                       order by x.valor desc, x.tipo)
        from (select e.tipo, count(*) as qtd, coalesce(sum(e.valor_cents), 0) as valor
                from e group by e.tipo) x
    ), '[]'::jsonb)
  ) into v_entradas;

  with s as (
    select d.categoria, d.valor_cents
      from public.clinica_despesas d
     where d.organization_id = p_org
       and d.pago_em >= p_de
       and d.pago_em < p_ate
  )
  select jsonb_build_object(
    'qtd', (select count(*) from s),
    'total_cents', (select coalesce(sum(s.valor_cents), 0) from s),
    'por_categoria', coalesce((
      select jsonb_agg(jsonb_build_object('categoria', x.categoria, 'qtd', x.qtd,
                                          'valor_cents', x.valor)
                       order by x.valor desc, x.categoria)
        from (select s.categoria, count(*) as qtd, sum(s.valor_cents) as valor
                from s group by s.categoria) x
    ), '[]'::jsonb)
  ) into v_saidas;

  with r as (
    select f.tipo, f.valor_cents
      from public.fn_clinica_financeiro_a_receber(p_org, p_de, p_ate) f
  )
  select jsonb_build_object(
    'qtd', (select count(*) from r),
    'total_cents', (select coalesce(sum(r.valor_cents), 0) from r),
    'sem_valor', (select count(*) from r where r.valor_cents is null),
    'por_tipo', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'qtd', x.qtd, 'valor_cents', x.valor)
                       order by x.valor desc, x.tipo)
        from (select r.tipo, count(*) as qtd, coalesce(sum(r.valor_cents), 0) as valor
                from r group by r.tipo) x
    ), '[]'::jsonb)
  ) into v_receber;

  return jsonb_build_object('entradas', v_entradas, 'saidas', v_saidas, 'a_receber', v_receber);
end;
$f$;

revoke execute on function public.fn_clinica_financeiro_resumo(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_financeiro_resumo(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- as entradas, uma linha por pagamento ----
create or replace function public.fn_clinica_financeiro_entradas(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  id uuid,
  pago_em timestamptz,
  tipo text,
  descricao text,
  referente_em timestamptz,
  forma text,
  valor_cents bigint,
  currency text,
  contact_id uuid,
  contato_name text,
  contato_display_name text,
  contato_phone text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
#variable_conflict use_column
begin
  return query
  select pg.id,
         pg.pago_em,
         case when pg.pacote_id is not null then 'pacote'
              when pg.appointment_id is not null then 'sessao'
              else 'multa' end,
         case when pg.pacote_id is not null then pc.nome
              when pg.appointment_id is not null then coalesce(et.name, a.title)
              when m.origem = 'falta' then 'Multa por falta'
              else 'Multa de cancelamento' end,
         case when pg.pacote_id is not null then pc.comprado_em
              when pg.appointment_id is not null then a.starts_at
              else am.starts_at end,
         pg.forma,
         pg.valor_cents::bigint,
         pg.currency,
         pg.contact_id,
         c.name,
         c.display_name,
         c.phone_number
    from public.clinica_pagamentos pg
    left join public.clinica_pacotes pc on pc.id = pg.pacote_id and pc.organization_id = p_org
    left join public.calendar_appointments a on a.id = pg.appointment_id and a.organization_id = p_org
    left join public.calendar_event_types et on et.id = a.event_type_id
    left join public.clinica_multas m on m.id = pg.multa_id and m.organization_id = p_org
    left join public.calendar_appointments am on am.id = m.appointment_id and am.organization_id = p_org
    left join public.contacts c on c.id = pg.contact_id and c.organization_id = p_org
   where pg.organization_id = p_org
     and pg.pago_em >= p_de
     and pg.pago_em < p_ate
   order by pg.pago_em desc, pg.id;
end;
$f$;

revoke execute on function public.fn_clinica_financeiro_entradas(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_financeiro_entradas(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- o que falta cobrar, uma linha por item ----
create or replace function public.fn_clinica_financeiro_a_receber(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  tipo text,
  id uuid,
  desde timestamptz,
  descricao text,
  valor_cents bigint,
  currency text,
  contact_id uuid,
  contato_name text,
  contato_display_name text,
  contato_phone text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
#variable_conflict use_column
begin
  return query
  with itens as (
    -- Pacote ativo vendido no período e ainda não pago.
    select 'pacote'::text as tipo, p.id, p.comprado_em as desde, p.nome as descricao,
           p.valor_cents::bigint as valor_cents, p.currency, p.contact_id
      from public.clinica_pacotes p
     where p.organization_id = p_org
       and p.status = 'ativo'
       and p.comprado_em >= p_de
       and p.comprado_em < p_ate
       and not exists (select 1 from public.clinica_pagamentos pg
                        where pg.organization_id = p_org and pg.pacote_id = p.id)
    union all
    -- Sessão avulsa realizada no período (não gastou pacote) e ainda não paga.
    select 'sessao'::text, a.id, a.starts_at, coalesce(et.name, a.title),
           et.default_price_cents::bigint, 'BRL'::text, a.contact_id
      from public.calendar_appointments a
      join public.clinica_tipos_atendimento t
        on t.organization_id = p_org and t.event_type_id = a.event_type_id
      left join public.calendar_event_types et on et.id = a.event_type_id
     where a.organization_id = p_org
       and a.status = 'completed'
       and a.contact_id is not null
       and a.starts_at >= p_de
       and a.starts_at < p_ate
       and not exists (select 1 from public.clinica_pacote_consumos pc
                        where pc.organization_id = p_org and pc.appointment_id = a.id)
       and not exists (select 1 from public.clinica_pagamentos pg
                        where pg.organization_id = p_org and pg.appointment_id = a.id)
    union all
    -- Multa gerada no período e ainda pendente (a paga vira `paga`; a isenta não se cobra).
    select 'multa'::text, m.id, m.created_at,
           case when m.origem = 'falta' then 'Multa por falta' else 'Multa de cancelamento' end,
           m.valor_cents::bigint, m.currency, m.contact_id
      from public.clinica_multas m
     where m.organization_id = p_org
       and m.status = 'pendente'
       and m.created_at >= p_de
       and m.created_at < p_ate
       and not exists (select 1 from public.clinica_pagamentos pg
                        where pg.organization_id = p_org and pg.multa_id = m.id)
  )
  select i.tipo, i.id, i.desde, i.descricao, i.valor_cents, i.currency, i.contact_id,
         c.name, c.display_name, c.phone_number
    from itens i
    left join public.contacts c on c.id = i.contact_id and c.organization_id = p_org
   order by i.desde, i.tipo, i.id;
end;
$f$;

revoke execute on function public.fn_clinica_financeiro_a_receber(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_financeiro_a_receber(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- onde o módulo já está instalado ----
do $do$
begin
  if to_regclass('public.clinica_pagamentos') is not null then
    perform public.fn_clinica_provisionar_despesas();
  end if;
end;
$do$;
