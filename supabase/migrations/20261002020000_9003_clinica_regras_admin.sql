-- 9003 — Clínica: as regras da clínica só o administrador altera, e o preço só ele vê.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (02/10/2026): os valores do negócio ficam numa tela de configurações que só o
-- administrador altera, e o que os outros perfis não devem ver fica escondido deles.
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_politicas` ganha os parâmetros das regras de negócio da TOQ que a clínica pode
--    querer mudar (`/mnt/project-files/produto/regras-de-negocio.md`, seções 2 a 5): tamanho e
--    validade do pacote padrão, reposições por mês, congelamento, aviso de renovação, alertas de
--    falta, inatividade e evolução atrasada. Os de pacote e alerta ficam guardados agora e
--    passam a valer quando essas partes forem construídas; a tela diz isso.
-- 2. O PREÇO sai de `clinica_tipos_atendimento` para `clinica_precos`, que só o `admin` lê. A
--    modalidade continua legível por todos, porque a agenda pinta e aplica as regras por ela.
--    Quem já tinha preço gravado (9002) o leva para a tabela nova; a coluna velha sai.
-- 3. Escrever política, modalidade e preço passa de `manager`+ para `admin`.
-- 4. A lista de multas (com valor) passa a ser de `agent`+: a recepção cobra e isenta; o perfil
--    "Somente leitura" não vê valor financeiro.
--
-- O servidor lê preço e política com o client de serviço, filtrando a organização do contexto
-- autenticado (`lib/clinica/regras-da-agenda.ts`), para a multa sair com valor mesmo quando
-- quem cancela é a recepção.
--
-- ── Por que recriar a auxiliar da agenda, e não a provisionadora do módulo ──────────────────
-- `fn_clinica_provisionar()` continua chamando `fn_clinica_provisionar_agenda()`; só o corpo
-- da auxiliar muda. Assim o prontuário (que é de outra frente) não é tocado. O corpo é o da
-- 9002 com as mudanças acima, e é idempotente: reaplicar não duplica nada.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabelas do módulo. Sem o módulo instalado, nada disto existe.

-- ---- a provisionadora auxiliar da agenda, com as regras e o preço (9003) ----
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

  -- ── o preço de cada tipo de agendamento: só o administrador vê (9003) ─────
  -- Separado da modalidade porque a modalidade é de todos (a agenda pinta por ela) e o preço é
  -- valor financeiro. A RLS não esconde coluna; esconde linha, e por isso é outra tabela.
  create table if not exists public.clinica_precos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    event_type_id uuid not null references public.calendar_event_types(id) on delete cascade,
    -- Valor de UMA sessão avulsa, base da multa.
    valor_cents int not null check (valor_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
    updated_by_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_precos_um_por_tipo unique (organization_id, event_type_id)
  );

  create index if not exists clinica_precos_tipo_idx
    on public.clinica_precos (event_type_id);

  drop trigger if exists trg_clinica_preco_da_mesma_org on public.clinica_precos;
  create trigger trg_clinica_preco_da_mesma_org
    before insert or update on public.clinica_precos
    for each row execute function public.fn_clinica_tipo_da_mesma_org();

  -- Quem tinha o preço na tabela de modalidade (9002) o leva para cá, e a coluna sai. Dinâmico
  -- porque, depois da primeira vez, a coluna não existe mais e o SQL estático não compilaria.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'clinica_tipos_atendimento'
       and column_name = 'valor_cents'
  ) then
    execute $m$
      insert into public.clinica_precos (organization_id, event_type_id, valor_cents, currency)
      select organization_id, event_type_id, valor_cents, currency
        from public.clinica_tipos_atendimento
       where valor_cents is not null
      on conflict (organization_id, event_type_id) do nothing
    $m$;
    alter table public.clinica_tipos_atendimento
      drop column if exists valor_cents,
      drop column if exists currency;
  end if;

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

  alter table public.clinica_precos enable row level security;
  drop policy if exists clinica_precos_select on public.clinica_precos;
  create policy clinica_precos_select
    on public.clinica_precos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_precos_insert on public.clinica_precos;
  create policy clinica_precos_insert
    on public.clinica_precos
    for insert with check (organization_id in (select public.fn_user_org_ids())
                           and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_precos_update on public.clinica_precos;
  create policy clinica_precos_update
    on public.clinica_precos
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));
  drop policy if exists clinica_precos_delete on public.clinica_precos;
  create policy clinica_precos_delete
    on public.clinica_precos
    for delete using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_precos from anon;

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
    'Modalidade de cada tipo de agendamento do núcleo. Referência, não coluna no núcleo (ADR-0002 D4). O preço mora em clinica_precos.';
  comment on table public.clinica_precos is
    'Preço da sessão avulsa de cada tipo de agendamento, base da multa. Só o administrador lê e altera.';
  comment on table public.clinica_agenda_historico is
    'O que aconteceu com cada sessão (remarcação de/para, cancelamento, falta, realização, confirmação) e quem fez. Só o servidor escreve.';
  comment on table public.clinica_multas is
    'Multa do cancelamento em cima da hora, com os parâmetros da política no momento. Isenção exige motivo. Só o servidor escreve.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_agenda() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_agenda() to service_role;
