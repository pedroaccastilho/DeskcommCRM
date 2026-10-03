-- 9005 — Clínica: origem do paciente (por onde ele chegou) e o relatório por canal.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Regras: `/mnt/project-files/produto/regras-de-negocio.md` §2 (registrar a origem sempre) e o
-- item 8 do backlog. A TOQ capta pelo WhatsApp, pelo Instagram (influenciador ou anúncio pago),
-- por indicação (de qual paciente) e por encaminhamento médico (de qual médico).
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_origens` — a lista de origens da clínica, configurável pelo administrador. Cada uma
--    tem um TIPO fixo, que diz o que a recepção precisa contar: Instagram e encaminhamento pedem
--    o detalhe (qual influenciador ou anúncio, qual médico), indicação pede o paciente que
--    indicou. O tipo é vocabulário do módulo; o nome é da clínica ("Anúncio pago", "@fulana").
--    A lista padrão nasce na primeira leitura (`lib/clinica/origens-servidor.ts`), não aqui: a
--    provisionadora só cria o schema.
-- 2. `clinica_pacientes_origem` — a origem de cada paciente, uma linha por contato, gravada pela
--    recepção. REFERENCIA `contacts` em vez de pôr coluna no núcleo (D4).
--
-- ── "WhatsApp" sozinho, sem gatilho ─────────────────────────────────────────────────────────
-- O núcleo já grava `contacts.source = 'whatsapp'` quando o contato nasce de uma mensagem. Sem
-- linha da recepção, a origem do paciente é CALCULADA a partir disso (DIRC "calcular"): a origem
-- do tipo `whatsapp` da clínica, marcada como automática. A recepção pode corrigir a qualquer
-- momento (o paciente veio do Instagram e chamou no WhatsApp), e a linha dela vence.
--
-- ── O relatório ─────────────────────────────────────────────────────────────────────────────
-- `fn_clinica_relatorio_origens(org, de, ate)` agrupa os contatos NOVOS do período (criados entre
-- `de` e `ate`, só pessoas, sem os mesclados) por origem e detalhe, e conta quantos compraram
-- pacote e quanto os pacotes deles somam. Só o servidor chama (service_role), com a organização
-- da sessão.
--
-- ── Por que recriar a provisionadora dos pacotes ────────────────────────────────────────────
-- A nova `fn_clinica_provisionar_origens()` é chamada no fim de `fn_clinica_provisionar_pacotes()`
-- (9004), recriada aqui com o mesmo corpo e uma linha a mais. `fn_clinica_provisionar()` e
-- `fn_clinica_provisionar_agenda()` não mudam.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabelas e funções do módulo. Sem o módulo, `contacts.source` segue como sempre.

-- ---- a provisionadora das origens ----
create or replace function public.fn_clinica_provisionar_origens()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── a lista de origens da clínica ─────────────────────────────────────────
  create table if not exists public.clinica_origens (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    nome text not null check (length(btrim(nome)) between 2 and 60),
    tipo text not null
      check (tipo in ('whatsapp', 'instagram', 'indicacao', 'encaminhamento', 'outro')),
    ativo boolean not null default true,
    ordem int not null default 100 check (ordem between 0 and 1000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_origens_nome_unico unique (organization_id, nome)
  );

  -- ── a origem de cada paciente ─────────────────────────────────────────────
  create table if not exists public.clinica_pacientes_origem (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `cascade`: a origem é um atributo do contato; sem ele, não há o que guardar.
    contact_id uuid not null references public.contacts(id) on delete cascade,
    -- `restrict`: origem em uso não some; tirar da lista é desligar (`ativo = false`).
    origem_id uuid not null references public.clinica_origens(id) on delete restrict,
    -- Qual influenciador ou anúncio, qual médico. Obrigatório para esses tipos (a rota cobra).
    detalhe text check (detalhe is null or length(btrim(detalhe)) between 1 and 200),
    -- O paciente que indicou. `set null`: apagar quem indicou não apaga a origem de quem veio.
    indicado_por_contact_id uuid references public.contacts(id) on delete set null,
    registrado_por_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_pacientes_origem_um_por_paciente unique (organization_id, contact_id),
    constraint clinica_pacientes_origem_nao_se_indica check (
      indicado_por_contact_id is null or indicado_por_contact_id <> contact_id
    )
  );

  create index if not exists clinica_pacientes_origem_origem_idx
    on public.clinica_pacientes_origem (organization_id, origem_id);
  create index if not exists clinica_pacientes_origem_indicou_idx
    on public.clinica_pacientes_origem (organization_id, indicado_por_contact_id)
    where indicado_por_contact_id is not null;

  -- ── RLS ───────────────────────────────────────────────────────────────────
  -- A origem não é dado clínico nem financeiro: todo membro lê (a agenda e a ficha mostram).
  -- A lista só o administrador altera. A origem do paciente só o servidor grava, depois de
  -- conferir o papel (recepção para cima) e que o paciente e quem indicou são desta clínica.
  alter table public.clinica_origens enable row level security;
  drop policy if exists clinica_origens_select on public.clinica_origens;
  create policy clinica_origens_select
    on public.clinica_origens
    for select using (organization_id in (select public.fn_user_org_ids()));
  drop policy if exists clinica_origens_insert on public.clinica_origens;
  create policy clinica_origens_insert
    on public.clinica_origens
    for insert with check (organization_id in (select public.fn_user_org_ids())
                           and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_origens_update on public.clinica_origens;
  create policy clinica_origens_update
    on public.clinica_origens
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_origens from anon;

  alter table public.clinica_pacientes_origem enable row level security;
  drop policy if exists clinica_pacientes_origem_select on public.clinica_pacientes_origem;
  create policy clinica_pacientes_origem_select
    on public.clinica_pacientes_origem
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_pacientes_origem from anon;

  comment on table public.clinica_origens is
    'Origens de paciente da clínica (WhatsApp, Instagram, indicação, encaminhamento médico, outras). O tipo diz que detalhe a recepção registra. Só o administrador altera; tirar da lista é desligar.';
  comment on table public.clinica_pacientes_origem is
    'Por onde o paciente chegou, registrado pela recepção, com o detalhe (influenciador, anúncio, médico) ou quem indicou. Sem linha, a origem é calculada de contacts.source (whatsapp). Só o servidor escreve.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_origens() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_origens() to service_role;

-- ---- o relatório por origem ----
-- Contatos NOVOS do período (só pessoas, sem mesclados), agrupados pela origem efetiva: a da
-- recepção ou, sem ela, a do tipo `whatsapp` quando o núcleo registrou o contato pelo WhatsApp.
-- `origem_id` NULL = sem origem registrada. Conta os que compraram pacote (qualquer data depois
-- de chegar) e a soma do valor desses pacotes, sem os cancelados.
create or replace function public.fn_clinica_relatorio_origens(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  origem_id uuid,
  detalhe text,
  automatica boolean,
  novos int,
  com_pacote int,
  pacotes int,
  pacotes_valor_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
#variable_conflict use_column
begin
  return query
  with novos as (
    select c.id, c.source
      from public.contacts c
     where c.organization_id = p_org
       and c.created_at >= p_de
       and c.created_at < p_ate
       and c.kind = 'person'
       and c.is_merged_into is null
  ),
  whatsapp as (
    select o.id
      from public.clinica_origens o
     where o.organization_id = p_org and o.tipo = 'whatsapp'
     order by o.ativo desc, o.ordem, o.created_at
     limit 1
  ),
  efetiva as (
    select n.id as contact_id,
           coalesce(po.origem_id, case when n.source = 'whatsapp' then (select w.id from whatsapp w) end)
             as origem_id,
           case when po.id is null then null else nullif(btrim(po.detalhe), '') end as detalhe,
           (po.id is null and n.source = 'whatsapp') as automatica
      from novos n
      left join public.clinica_pacientes_origem po
        on po.organization_id = p_org and po.contact_id = n.id
  ),
  vendas as (
    select p.contact_id, count(*)::int as qtd, coalesce(sum(p.valor_cents), 0)::bigint as valor
      from public.clinica_pacotes p
     where p.organization_id = p_org
       and p.status <> 'cancelado'
       and p.contact_id in (select e.contact_id from efetiva e)
     group by p.contact_id
  )
  select e.origem_id,
         e.detalhe,
         e.automatica,
         count(*)::int,
         count(v.contact_id)::int,
         coalesce(sum(v.qtd), 0)::int,
         coalesce(sum(v.valor), 0)::bigint
    from efetiva e
    left join vendas v on v.contact_id = e.contact_id
   group by e.origem_id, e.detalhe, e.automatica;
end;
$f$;

revoke execute on function public.fn_clinica_relatorio_origens(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_relatorio_origens(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- a provisionadora dos pacotes passa a chamar a das origens (9005) ----
-- O corpo é o da 9004, sem mudança, mais a última linha. Idempotente como antes.
create or replace function public.fn_clinica_provisionar_pacotes()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── o catálogo: os pacotes que a clínica vende ────────────────────────────
  create table if not exists public.clinica_produtos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    nome text not null check (length(btrim(nome)) between 2 and 120),
    modalidade text not null
      check (modalidade in ('fisioterapia', 'pilates', 'medicina', 'enfermagem')),
    sessoes int not null check (sessoes between 1 and 100),
    validade_dias int not null check (validade_dias between 1 and 730),
    -- NULL enquanto a clínica não definiu o preço. O pacote funciona sem ele.
    valor_cents bigint check (valor_cents is null or valor_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    ativo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_produtos_nome_unico unique (organization_id, nome)
  );

  -- ── o pacote vendido a um paciente ────────────────────────────────────────
  create table if not exists public.clinica_pacotes (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `restrict`: o pacote é registro financeiro do paciente; a LGPD anonimiza, não apaga.
    contact_id uuid not null references public.contacts(id) on delete restrict,
    -- De qual item do catálogo saiu. `set null`: tirar o item do catálogo não apaga o vendido.
    produto_id uuid references public.clinica_produtos(id) on delete set null,
    -- Cópia do que foi vendido: o catálogo pode mudar depois da venda.
    nome text not null check (length(btrim(nome)) between 2 and 120),
    modalidade text not null
      check (modalidade in ('fisioterapia', 'pilates', 'medicina', 'enfermagem')),
    sessoes_total int not null check (sessoes_total between 1 and 100),
    valor_cents bigint check (valor_cents is null or valor_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    comprado_em timestamptz not null default now(),
    -- Já inclui congelamento e prorrogação: quem lê não refaz a conta.
    valido_ate timestamptz not null,
    status text not null default 'ativo' check (status in ('ativo', 'cancelado')),
    -- Congelamento por viagem ou afastamento: uma vez por pacote.
    congelado_em timestamptz,
    congelado_dias int check (congelado_dias is null or congelado_dias between 1 and 180),
    cancelado_em timestamptz,
    cancelamento_motivo text,
    -- O aceite da política de cancelamento na compra, com os termos daquele momento.
    aceite_politica_em timestamptz not null,
    aceite_multa_pct int not null check (aceite_multa_pct between 0 and 100),
    aceite_antecedencia_horas int not null check (aceite_antecedencia_horas between 0 and 168),
    vendido_por_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_pacotes_validade_depois_da_compra check (valido_ate > comprado_em),
    constraint clinica_pacotes_congelamento_inteiro check (
      (congelado_em is null) = (congelado_dias is null)
    ),
    constraint clinica_pacotes_cancelamento_justificado check (
      (status = 'cancelado') = (
        cancelado_em is not null
        and cancelamento_motivo is not null
        and length(btrim(cancelamento_motivo)) between 3 and 1000
      )
    )
  );

  create index if not exists clinica_pacotes_paciente_idx
    on public.clinica_pacotes (organization_id, contact_id, modalidade, status, valido_ate);
  create index if not exists clinica_pacotes_org_status_idx
    on public.clinica_pacotes (organization_id, status, valido_ate);

  -- ── cada sessão que gastou o pacote ───────────────────────────────────────
  create table if not exists public.clinica_pacote_consumos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    pacote_id uuid not null references public.clinica_pacotes(id) on delete cascade,
    -- `set null`: apagar o compromisso no núcleo não devolve a sessão gasta.
    appointment_id uuid references public.calendar_appointments(id) on delete set null,
    motivo text not null check (motivo in ('realizada', 'falta')),
    sessao_em timestamptz not null,
    consumido_em timestamptz not null default now(),
    constraint clinica_pacote_consumos_uma_por_sessao unique (appointment_id)
  );

  create index if not exists clinica_pacote_consumos_pacote_idx
    on public.clinica_pacote_consumos (pacote_id);
  create index if not exists clinica_pacote_consumos_org_idx
    on public.clinica_pacote_consumos (organization_id, sessao_em desc);

  -- ── congelamento, prorrogação e cancelamento ──────────────────────────────
  create table if not exists public.clinica_pacote_eventos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    pacote_id uuid not null references public.clinica_pacotes(id) on delete cascade,
    tipo text not null check (tipo in ('congelamento', 'prorrogacao', 'cancelamento')),
    dias int check (dias is null or dias between 1 and 730),
    motivo text not null check (length(btrim(motivo)) between 3 and 1000),
    -- No cancelamento: o reembolso sugerido (sessões restantes pelo preço avulso), quando há.
    valor_cents bigint check (valor_cents is null or valor_cents >= 0),
    por_user_id uuid references auth.users(id) on delete set null,
    registrado_em timestamptz not null default now(),
    constraint clinica_pacote_eventos_dias_quando_muda_prazo check (
      (tipo = 'cancelamento') = (dias is null)
    )
  );

  create index if not exists clinica_pacote_eventos_pacote_idx
    on public.clinica_pacote_eventos (pacote_id, registrado_em);

  -- ── RLS ───────────────────────────────────────────────────────────────────
  -- Valor de pacote é financeiro: "Somente leitura" não vê (como a multa, 9003). A recepção
  -- (`agent`+) vê, vende e congela. O catálogo só o administrador altera. Pacote, consumo e
  -- evento não têm policy de escrita: só o servidor escreve, depois de conferir o papel.
  alter table public.clinica_produtos enable row level security;
  drop policy if exists clinica_produtos_select on public.clinica_produtos;
  create policy clinica_produtos_select
    on public.clinica_produtos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'agent'));
  drop policy if exists clinica_produtos_insert on public.clinica_produtos;
  create policy clinica_produtos_insert
    on public.clinica_produtos
    for insert with check (organization_id in (select public.fn_user_org_ids())
                           and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_produtos_update on public.clinica_produtos;
  create policy clinica_produtos_update
    on public.clinica_produtos
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_produtos from anon;

  alter table public.clinica_pacotes enable row level security;
  drop policy if exists clinica_pacotes_select on public.clinica_pacotes;
  create policy clinica_pacotes_select
    on public.clinica_pacotes
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'agent'));
  revoke all on public.clinica_pacotes from anon;

  alter table public.clinica_pacote_consumos enable row level security;
  drop policy if exists clinica_pacote_consumos_select on public.clinica_pacote_consumos;
  create policy clinica_pacote_consumos_select
    on public.clinica_pacote_consumos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'agent'));
  revoke all on public.clinica_pacote_consumos from anon;

  alter table public.clinica_pacote_eventos enable row level security;
  drop policy if exists clinica_pacote_eventos_select on public.clinica_pacote_eventos;
  create policy clinica_pacote_eventos_select
    on public.clinica_pacote_eventos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'agent'));
  revoke all on public.clinica_pacote_eventos from anon;

  comment on table public.clinica_produtos is
    'Pacotes que a clínica vende (sessões, validade, valor opcional). Só o administrador altera.';
  comment on table public.clinica_pacotes is
    'Pacote vendido a um paciente, de uma modalidade, com a cópia do que foi vendido e o aceite da política de cancelamento. Saldo = sessoes_total menos os consumos. Só o servidor escreve.';
  comment on table public.clinica_pacote_consumos is
    'Sessão que gastou o pacote (realizada ou falta sem aviso). Uma por sessão. Só o servidor escreve, por fn_clinica_consumir_sessao.';
  comment on table public.clinica_pacote_eventos is
    'Congelamento, prorrogação e cancelamento do pacote, com motivo e quem fez. Só o servidor escreve, por fn_clinica_ajustar_pacote.';

  -- A origem do paciente (migration 9005), depois das tabelas dos pacotes (o relatório as lê).
  perform public.fn_clinica_provisionar_origens();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_pacotes() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_pacotes() to service_role;
