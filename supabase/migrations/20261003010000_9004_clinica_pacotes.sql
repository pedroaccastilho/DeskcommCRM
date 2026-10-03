-- 9004 — Clínica: pacotes de sessões (o "pacote de 10 sessões que vale 60 dias").
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Regras: `/mnt/project-files/produto/regras-de-negocio.md`, seções 4 e 5 (02/10/2026).
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_produtos` — os pacotes que a clínica vende (nome, modalidade, quantas sessões,
--    validade e valor). O VALOR é opcional: a clínica ainda não definiu preços, e o pacote é
--    vendido e controlado sem ele. Só o administrador cadastra.
-- 2. `clinica_pacotes` — o pacote vendido a UM paciente, de UMA modalidade. Guarda a cópia do que
--    foi vendido (sessões, validade, valor) e o ACEITE da política de cancelamento no momento da
--    compra, com os termos daquele momento (a política pode mudar depois).
-- 3. `clinica_pacote_consumos` — cada sessão que gastou o pacote: realizada ou falta sem aviso.
--    Uma linha por sessão (é a idempotência). Cancelamento não consome, seja do paciente (gera
--    multa, que já existe) ou da clínica.
-- 4. `clinica_pacote_eventos` — congelamento, prorrogação e cancelamento do pacote, com motivo e
--    quem fez. A venda é a própria linha do pacote.
--
-- Duas funções `security definer`, chamadas só pelo servidor (service_role):
-- - `fn_clinica_consumir_sessao` — tranca os pacotes do paciente naquela modalidade e lança a
--   sessão no que vence primeiro e ainda tem saldo. Sem pacote válido, a sessão é avulsa e nada
--   acontece. Trancar é o que impede duas sessões marcadas ao mesmo tempo de passarem do total.
-- - `fn_clinica_ajustar_pacote` — congelar (uma vez por pacote, até o máximo das Regras),
--   prorrogar e cancelar, cada um com a mudança e o evento na mesma transação.
--
-- ── Por que recriar a auxiliar da agenda, e não a provisionadora do módulo ──────────────────
-- A provisionadora nova `fn_clinica_provisionar_pacotes()` é chamada no FIM de
-- `fn_clinica_provisionar_agenda()`, que é recriada aqui com o corpo da 9003 e essa linha a
-- mais. `fn_clinica_provisionar()` não é tocada: outras frentes (prontuário, plano de tratamento)
-- a recriam, e duas recriações da mesma função em PRs paralelos se sobrescreveriam.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabelas e funções do módulo. Sem o módulo instalado, nada disto existe, e a agenda do
-- núcleo não muda (o consumo é chamado por `lib/clinica/regras-da-agenda.ts`, que já é no-op
-- sem as tabelas).

-- ---- a provisionadora dos pacotes ----
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
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_pacotes() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_pacotes() to service_role;

-- ---- lançar uma sessão no pacote (ou tirar dele) ----
-- `p_motivo` NULL tira: a sessão deixou de contar (voltou para agendada, foi cancelada ou
-- remarcada). 'realizada' ou 'falta' lança no pacote que vence primeiro e ainda tem saldo, ou
-- troca o motivo se a sessão já estava lançada. Devolve o pacote e o saldo depois; nenhuma linha
-- quando a sessão é avulsa (sem pacote válido) ou quando não havia o que tirar.
create or replace function public.fn_clinica_consumir_sessao(
  p_org uuid,
  p_appointment uuid,
  p_modalidade text,
  p_motivo text
)
returns table (pacote_id uuid, saldo int, acao text)
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
#variable_conflict use_column
declare
  v_contato uuid;
  v_inicio timestamptz;
  v_lancado record;
  v_ja_lancada boolean;
  v_pacote record;
  v_usadas int;
begin
  if p_motivo is not null and p_motivo not in ('realizada', 'falta') then
    raise exception 'clinica_motivo_de_consumo_invalido' using errcode = '22023';
  end if;

  -- A sessão tem de ser desta organização; o paciente e a data vêm dela, nunca de quem chama.
  select a.contact_id, a.starts_at into v_contato, v_inicio
    from public.calendar_appointments a
   where a.id = p_appointment and a.organization_id = p_org;
  if not found then
    raise exception 'clinica_sessao_de_outra_organizacao' using errcode = '22023';
  end if;

  select c.id, c.pacote_id, c.motivo into v_lancado
    from public.clinica_pacote_consumos c
   where c.appointment_id = p_appointment and c.organization_id = p_org
   for update;
  v_ja_lancada := found;

  if p_motivo is null then
    if not v_ja_lancada then
      return;
    end if;
    delete from public.clinica_pacote_consumos where id = v_lancado.id;
    return query
      select v_lancado.pacote_id,
             (select p.sessoes_total - (select count(*)::int from public.clinica_pacote_consumos k
                                         where k.pacote_id = p.id)
                from public.clinica_pacotes p where p.id = v_lancado.pacote_id),
             'estornada'::text;
    return;
  end if;

  if v_ja_lancada then
    if v_lancado.motivo <> p_motivo then
      update public.clinica_pacote_consumos set motivo = p_motivo where id = v_lancado.id;
    end if;
    return query
      select v_lancado.pacote_id,
             (select p.sessoes_total - (select count(*)::int from public.clinica_pacote_consumos k
                                         where k.pacote_id = p.id)
                from public.clinica_pacotes p where p.id = v_lancado.pacote_id),
             'ja_lancada'::text;
    return;
  end if;

  if v_contato is null then
    return;
  end if;

  -- Tranca os candidatos ANTES de contar: duas sessões marcadas ao mesmo tempo esperam uma pela
  -- outra, e a segunda conta já com a primeira lançada (cada comando vê o que já foi gravado).
  for v_pacote in
    select p.id, p.sessoes_total
      from public.clinica_pacotes p
     where p.organization_id = p_org
       and p.contact_id = v_contato
       and p.modalidade = p_modalidade
       and p.status = 'ativo'
       and p.valido_ate >= v_inicio
     order by p.valido_ate, p.comprado_em, p.id
     for update
  loop
    select count(*)::int into v_usadas
      from public.clinica_pacote_consumos k where k.pacote_id = v_pacote.id;
    if v_usadas < v_pacote.sessoes_total then
      begin
        insert into public.clinica_pacote_consumos
          (organization_id, pacote_id, appointment_id, motivo, sessao_em)
        values (p_org, v_pacote.id, p_appointment, p_motivo, v_inicio);
      exception when unique_violation then
        -- Outra chamada lançou a mesma sessão no meio do caminho: vale a dela.
        return query
          select c.pacote_id, null::int, 'ja_lancada'::text
            from public.clinica_pacote_consumos c where c.appointment_id = p_appointment;
        return;
      end;
      return query select v_pacote.id, v_pacote.sessoes_total - v_usadas - 1, 'lancada'::text;
      return;
    end if;
  end loop;
  return;
end;
$f$;

revoke execute on function public.fn_clinica_consumir_sessao(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_consumir_sessao(uuid, uuid, text, text)
  to service_role;

-- ---- congelar, prorrogar ou cancelar um pacote ----
-- A mudança e o evento na mesma transação. Quem chama relê o pacote depois. O papel de quem pede é conferido pela rota antes
-- (congelar: recepção; prorrogar e cancelar: gerência); aqui ficam as regras do pacote.
create or replace function public.fn_clinica_ajustar_pacote(
  p_org uuid,
  p_pacote uuid,
  p_tipo text,
  p_dias int,
  p_motivo text,
  p_valor_cents bigint,
  p_user uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  -- `record`, não `%rowtype`: a função nasce no baseline antes de a tabela existir.
  v_pacote record;
  v_max int;
begin
  select * into v_pacote from public.clinica_pacotes
   where id = p_pacote and organization_id = p_org
   for update;
  if not found then
    raise exception 'clinica_pacote_nao_encontrado' using errcode = 'P0002';
  end if;
  if v_pacote.status <> 'ativo' then
    raise exception 'clinica_pacote_cancelado' using errcode = '22023';
  end if;

  if p_tipo = 'congelamento' then
    if v_pacote.congelado_em is not null then
      raise exception 'clinica_pacote_ja_congelado' using errcode = '22023';
    end if;
    if v_pacote.valido_ate < now() then
      raise exception 'clinica_pacote_vencido' using errcode = '22023';
    end if;
    select coalesce((select pol.congelamento_max_dias from public.clinica_politicas pol
                      where pol.organization_id = p_org), 30)
      into v_max;
    if p_dias is null or p_dias < 1 or p_dias > v_max then
      raise exception 'clinica_congelamento_acima_do_maximo' using errcode = '22023';
    end if;
    update public.clinica_pacotes
       set congelado_em = now(),
           congelado_dias = p_dias,
           valido_ate = valido_ate + make_interval(days => p_dias),
           updated_at = now()
     where id = p_pacote;
  elsif p_tipo = 'prorrogacao' then
    if p_dias is null or p_dias < 1 or p_dias > 730 then
      raise exception 'clinica_prorrogacao_invalida' using errcode = '22023';
    end if;
    update public.clinica_pacotes
       set valido_ate = greatest(valido_ate, now()) + make_interval(days => p_dias),
           updated_at = now()
     where id = p_pacote;
  elsif p_tipo = 'cancelamento' then
    update public.clinica_pacotes
       set status = 'cancelado',
           cancelado_em = now(),
           cancelamento_motivo = btrim(p_motivo),
           updated_at = now()
     where id = p_pacote;
  else
    raise exception 'clinica_ajuste_de_pacote_invalido' using errcode = '22023';
  end if;

  insert into public.clinica_pacote_eventos
    (organization_id, pacote_id, tipo, dias, motivo, valor_cents, por_user_id)
  values (
    p_org, p_pacote, p_tipo,
    case when p_tipo = 'cancelamento' then null else p_dias end,
    btrim(p_motivo),
    case when p_tipo = 'cancelamento' then p_valor_cents else null end,
    p_user
  );
end;
$f$;

revoke execute on function public.fn_clinica_ajustar_pacote(uuid, uuid, text, int, text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_ajustar_pacote(uuid, uuid, text, int, text, bigint, uuid)
  to service_role;

-- ---- a provisionadora auxiliar da agenda passa a chamar a dos pacotes (9004) ----
-- O corpo é o da 9003, sem mudança, mais a última linha. Idempotente como antes.
create or replace function public.fn_clinica_provisionar_agenda()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── política de faltas e cancelamento, uma linha por organização ─────────
  create table if not exists public.clinica_politicas (
    organization_id uuid primary key references public.organizations(id) on delete cascade,
    antecedencia_cancelamento_horas int not null default 24
      check (antecedencia_cancelamento_horas between 0 and 168),
    -- Percentual inteiro. 0 desliga a multa sem apagar a política.
    multa_cancelamento_pct int not null default 30
      check (multa_cancelamento_pct between 0 and 100),
    tolerancia_atraso_minutos int not null default 15
      check (tolerancia_atraso_minutos between 0 and 120),
    -- Pacote padrão: quantas sessões ele tem (10).
    pacote_sessoes_padrao int not null default 10
      check (pacote_sessoes_padrao between 1 and 100),
    -- Validade do pacote padrão, em dias a partir da compra (60).
    pacote_validade_dias int not null default 60
      check (pacote_validade_dias between 1 and 730),
    -- Reposições permitidas por mês no pilates (2).
    reposicoes_por_mes int not null default 2
      check (reposicoes_por_mes between 0 and 31),
    -- Congelamento por viagem ou afastamento, uma vez por pacote (30 dias).
    congelamento_max_dias int not null default 30
      check (congelamento_max_dias between 0 and 180),
    -- Avisar a renovação quando restarem N sessões (2).
    sessoes_restantes_aviso_renovacao int not null default 2
      check (sessoes_restantes_aviso_renovacao between 0 and 20),
    -- Faltas seguidas que geram alerta para a recepção (2).
    faltas_seguidas_alerta int not null default 2
      check (faltas_seguidas_alerta between 1 and 10),
    -- Faltas no mês que levam ao radar de abandono (3).
    faltas_no_mes_abandono int not null default 3
      check (faltas_no_mes_abandono between 1 and 31),
    -- Dias sem sessão e sem pacote ativo para o paciente virar inativo (30).
    dias_sem_sessao_inativo int not null default 30
      check (dias_sem_sessao_inativo between 1 and 365),
    -- Horas depois da sessão para a evolução aparecer como atrasada (24).
    horas_evolucao_atrasada int not null default 24
      check (horas_evolucao_atrasada between 1 and 168),
    updated_by_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- Quem já tinha a tabela da 9002 ganha os parâmetros novos (9003).
  alter table public.clinica_politicas
    add column if not exists pacote_sessoes_padrao int not null default 10
      check (pacote_sessoes_padrao between 1 and 100);
  alter table public.clinica_politicas
    add column if not exists pacote_validade_dias int not null default 60
      check (pacote_validade_dias between 1 and 730);
  alter table public.clinica_politicas
    add column if not exists reposicoes_por_mes int not null default 2
      check (reposicoes_por_mes between 0 and 31);
  alter table public.clinica_politicas
    add column if not exists congelamento_max_dias int not null default 30
      check (congelamento_max_dias between 0 and 180);
  alter table public.clinica_politicas
    add column if not exists sessoes_restantes_aviso_renovacao int not null default 2
      check (sessoes_restantes_aviso_renovacao between 0 and 20);
  alter table public.clinica_politicas
    add column if not exists faltas_seguidas_alerta int not null default 2
      check (faltas_seguidas_alerta between 1 and 10);
  alter table public.clinica_politicas
    add column if not exists faltas_no_mes_abandono int not null default 3
      check (faltas_no_mes_abandono between 1 and 31);
  alter table public.clinica_politicas
    add column if not exists dias_sem_sessao_inativo int not null default 30
      check (dias_sem_sessao_inativo between 1 and 365);
  alter table public.clinica_politicas
    add column if not exists horas_evolucao_atrasada int not null default 24
      check (horas_evolucao_atrasada between 1 and 168);

  -- ── modalidade de cada tipo de agendamento ────────────────────────────────
  create table if not exists public.clinica_tipos_atendimento (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `cascade`: apagar o tipo no núcleo apaga só esta etiqueta, nunca um compromisso.
    event_type_id uuid not null references public.calendar_event_types(id) on delete cascade,
    modalidade text not null
      check (modalidade in ('fisioterapia', 'pilates', 'medicina', 'enfermagem')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_tipos_atendimento_um_por_tipo unique (organization_id, event_type_id)
  );

  create index if not exists clinica_tipos_atendimento_tipo_idx
    on public.clinica_tipos_atendimento (event_type_id);

  drop trigger if exists trg_clinica_tipo_da_mesma_org on public.clinica_tipos_atendimento;
  create trigger trg_clinica_tipo_da_mesma_org
    before insert or update on public.clinica_tipos_atendimento
    for each row execute function public.fn_clinica_tipo_da_mesma_org();

  -- O preço da sessão saiu daqui (9003): ele já existe no núcleo, em
  -- `calendar_event_types.default_price_cents` (o "Preço padrão" de Tipos de agendamento, que a
  -- comanda também usa). Duas colunas de preço divergiriam. O valor que a 9002 gravou aqui é
  -- levado para lá pela migration, FORA desta função (a provisionadora não escreve no núcleo).
  alter table public.clinica_tipos_atendimento
    drop column if exists valor_cents,
    drop column if exists currency;

  -- ── o que aconteceu com cada sessão, e quem fez ───────────────────────────
  create table if not exists public.clinica_agenda_historico (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    appointment_id uuid not null references public.calendar_appointments(id) on delete cascade,
    acao text not null
      check (acao in ('remarcado', 'cancelado', 'falta', 'realizado', 'confirmado')),
    de_inicio timestamptz,
    para_inicio timestamptz,
    motivo text check (motivo is null or length(motivo) <= 2000),
    -- Quem fez. `por_tipo` diz a espécie (pessoa, IA, sistema); `por_user_id` só existe quando
    -- foi uma pessoa da equipe.
    por_tipo text not null check (por_tipo in ('user', 'ai', 'system')),
    por_user_id uuid references auth.users(id) on delete set null,
    registrado_em timestamptz not null default now(),
    constraint clinica_agenda_historico_remarcacao_tem_de_e_para check (
      acao <> 'remarcado' or (de_inicio is not null and para_inicio is not null)
    )
  );

  create index if not exists clinica_agenda_historico_compromisso_idx
    on public.clinica_agenda_historico (organization_id, appointment_id, registrado_em);

  -- ── a multa do cancelamento em cima da hora ───────────────────────────────
  create table if not exists public.clinica_multas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- Uma multa por sessão: é a idempotência (o handler captura 23505).
    appointment_id uuid not null references public.calendar_appointments(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete restrict,
    -- O que valia no momento do cancelamento: a política pode mudar depois.
    percentual int not null check (percentual between 1 and 100),
    antecedencia_horas numeric(8, 2) not null,
    -- NULL quando o tipo ainda não tem valor de sessão cadastrado.
    valor_cents int check (valor_cents is null or valor_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    status text not null default 'pendente' check (status in ('pendente', 'isenta', 'paga')),
    isencao_motivo text check (isencao_motivo is null or length(btrim(isencao_motivo)) between 3 and 1000),
    isenta_por_user_id uuid references auth.users(id) on delete set null,
    isenta_em timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_multas_uma_por_sessao unique (appointment_id),
    constraint clinica_multas_isencao_justificada check (
      (status = 'isenta') = (isencao_motivo is not null and isenta_em is not null)
    )
  );

  create index if not exists clinica_multas_org_status_idx
    on public.clinica_multas (organization_id, status, created_at desc);
  create index if not exists clinica_multas_paciente_idx
    on public.clinica_multas (organization_id, contact_id);

  -- ── RLS: leitura para a organização; escrita como descrito no cabeçalho ───
  alter table public.clinica_politicas enable row level security;
  drop policy if exists clinica_politicas_select on public.clinica_politicas;
  create policy clinica_politicas_select
    on public.clinica_politicas
    for select using (organization_id in (select public.fn_user_org_ids()));
  drop policy if exists clinica_politicas_insert on public.clinica_politicas;
  create policy clinica_politicas_insert
    on public.clinica_politicas
    for insert with check (organization_id in (select public.fn_user_org_ids())
                           and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_politicas_update on public.clinica_politicas;
  create policy clinica_politicas_update
    on public.clinica_politicas
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_politicas from anon;

  alter table public.clinica_tipos_atendimento enable row level security;
  drop policy if exists clinica_tipos_atendimento_select on public.clinica_tipos_atendimento;
  create policy clinica_tipos_atendimento_select
    on public.clinica_tipos_atendimento
    for select using (organization_id in (select public.fn_user_org_ids()));
  drop policy if exists clinica_tipos_atendimento_insert on public.clinica_tipos_atendimento;
  create policy clinica_tipos_atendimento_insert
    on public.clinica_tipos_atendimento
    for insert with check (organization_id in (select public.fn_user_org_ids())
                           and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_tipos_atendimento_update on public.clinica_tipos_atendimento;
  create policy clinica_tipos_atendimento_update
    on public.clinica_tipos_atendimento
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_tipos_atendimento_delete on public.clinica_tipos_atendimento;
  create policy clinica_tipos_atendimento_delete
    on public.clinica_tipos_atendimento
    for delete using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_tipos_atendimento from anon;

  alter table public.clinica_agenda_historico enable row level security;
  drop policy if exists clinica_agenda_historico_select on public.clinica_agenda_historico;
  create policy clinica_agenda_historico_select
    on public.clinica_agenda_historico
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_agenda_historico from anon;

  alter table public.clinica_multas enable row level security;
  drop policy if exists clinica_multas_select on public.clinica_multas;
  -- A recepção cobra e isenta a multa (`agent`+); "Somente leitura" não vê valor (9003).
  create policy clinica_multas_select
    on public.clinica_multas
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'agent'));
  revoke all on public.clinica_multas from anon;

  comment on table public.clinica_politicas is
    'Regras da clínica (uma linha por organização): faltas e cancelamento, pacotes e alertas. Sem linha valem os padrões das colunas. Só o administrador altera.';
  comment on table public.clinica_tipos_atendimento is
    'Modalidade de cada tipo de agendamento do núcleo. Referência, não coluna no núcleo (ADR-0002 D4). O preço da sessão é o default_price_cents do tipo.';
  comment on table public.clinica_agenda_historico is
    'O que aconteceu com cada sessão (remarcação de/para, cancelamento, falta, realização, confirmação) e quem fez. Só o servidor escreve.';
  comment on table public.clinica_multas is
    'Multa do cancelamento em cima da hora, com os parâmetros da política no momento. Isenção exige motivo. Só o servidor escreve.';

  -- Os pacotes de sessões (migration 9004), depois das tabelas da agenda.
  perform public.fn_clinica_provisionar_pacotes();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_agenda() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_agenda() to service_role;
