-- 9002 — Clínica: a agenda da clínica (modalidade, política de faltas, multa e histórico).
--
-- Faixa 9xxx do fork TOQ, como a 9001. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
--
-- ── O que a agenda do núcleo JÁ faz, e por isso não entra aqui ──────────────────────────────
-- Os cinco estados que a clínica pediu (aguardando confirmação, confirmado, realizado, não
-- compareceu, cancelado) são `calendar_appointments.status`. A confirmação pelo WhatsApp é a
-- ferramenta `crm_confirm_appointment` do agente sobre um tipo com `requires_confirmation`. O
-- conflito de horário do mesmo profissional (sessão individual em cima de outra) já é recusado
-- pelo handler da agenda (`exigeSemSobreposicao`), pela tela e pela IA.
--
-- ── O que a clínica acrescenta (quatro tabelas, todas do módulo) ────────────────────────────
-- 1. `clinica_politicas` — uma linha por organização: antecedência do cancelamento sem multa
--    (24h), percentual da multa (30%), tolerância de atraso (15 min). Sem linha = os padrões
--    acima, que vivem em `lib/clinica/agenda.ts` (POLITICA_PADRAO) e são a única outra cópia.
-- 2. `clinica_tipos_atendimento` — a MODALIDADE e o valor da sessão de cada tipo de
--    agendamento do núcleo. REFERENCIA `calendar_event_types` em vez de pôr coluna lá (D4: a
--    provisionadora não mexe no núcleo).
-- 3. `clinica_agenda_historico` — remarcação (de quando para quando), cancelamento, falta e
--    realização, com quem fez. O núcleo remarca no lugar (`starts_at` muda na mesma linha) e não
--    guarda o horário antigo; é este histórico que responde "quem remarcou e de quando".
-- 4. `clinica_multas` — a multa do cancelamento em cima da hora, com isenção justificada.
--
-- ── Quem escreve ─────────────────────────────────────────────────────────────────────────────
-- Política e tipos: `manager`+ pela sessão (RLS). Histórico e multa: só o servidor, depois que
-- o handler da agenda grava a mudança (`lib/clinica/regras-da-agenda.ts`, chamado por
-- `lib/agenda/regras-de-modulo.ts`). Não há policy de escrita para a sessão nessas duas, então
-- ninguém fabrica uma multa ou apaga um rastro pela API REST do Supabase. O mesmo caminho serve
-- à tela e ao agente de IA, que chamam o mesmo handler.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Sem o módulo, a agenda do núcleo segue inteira. O ponto de extensão no núcleo é um só arquivo
-- (`lib/agenda/regras-de-modulo.ts`) que não faz nada quando as tabelas não existem.
--
-- ── Por que uma provisionadora auxiliar ─────────────────────────────────────────────────────
-- `fn_clinica_provisionar()` continua sendo a única que `fn_modulo_instalar('clinica')` chama;
-- ela passa a chamar `fn_clinica_provisionar_agenda()` antes das proteções. Assim o prontuário e
-- a agenda evoluem cada um na sua função. O nome NÃO termina em `_provisionar` de propósito: o
-- catálogo de módulos é `fn_<modulo>_provisionar()`, e a auxiliar não é um módulo instalável.

-- ---- a provisionadora auxiliar da agenda ----
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
    updated_by_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  -- ── modalidade e valor de cada tipo de agendamento ────────────────────────
  create table if not exists public.clinica_tipos_atendimento (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `cascade`: apagar o tipo no núcleo apaga só esta etiqueta, nunca um compromisso.
    event_type_id uuid not null references public.calendar_event_types(id) on delete cascade,
    modalidade text not null
      check (modalidade in ('fisioterapia', 'pilates', 'medicina', 'enfermagem')),
    -- Valor de UMA sessão, base da multa. NULL = ainda sem preço; a multa nasce sem valor.
    valor_cents int check (valor_cents is null or valor_cents >= 0),
    currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
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
                           and public.fn_role_at_least(organization_id, 'manager'));
  drop policy if exists clinica_politicas_update on public.clinica_politicas;
  create policy clinica_politicas_update
    on public.clinica_politicas
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'manager'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager'));
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
                           and public.fn_role_at_least(organization_id, 'manager'));
  drop policy if exists clinica_tipos_atendimento_update on public.clinica_tipos_atendimento;
  create policy clinica_tipos_atendimento_update
    on public.clinica_tipos_atendimento
    for update using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'manager'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'manager'));
  drop policy if exists clinica_tipos_atendimento_delete on public.clinica_tipos_atendimento;
  create policy clinica_tipos_atendimento_delete
    on public.clinica_tipos_atendimento
    for delete using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'manager'));
  revoke all on public.clinica_tipos_atendimento from anon;

  alter table public.clinica_agenda_historico enable row level security;
  drop policy if exists clinica_agenda_historico_select on public.clinica_agenda_historico;
  create policy clinica_agenda_historico_select
    on public.clinica_agenda_historico
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_agenda_historico from anon;

  alter table public.clinica_multas enable row level security;
  drop policy if exists clinica_multas_select on public.clinica_multas;
  create policy clinica_multas_select
    on public.clinica_multas
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_multas from anon;

  comment on table public.clinica_politicas is
    'Política de faltas da clínica: antecedência do cancelamento sem multa, percentual da multa e tolerância de atraso. Sem linha valem 24h, 30% e 15 min.';
  comment on table public.clinica_tipos_atendimento is
    'Modalidade e valor da sessão de cada tipo de agendamento do núcleo. Referência, não coluna no núcleo (ADR-0002 D4).';
  comment on table public.clinica_agenda_historico is
    'O que aconteceu com cada sessão (remarcação de/para, cancelamento, falta, realização, confirmação) e quem fez. Só o servidor escreve.';
  comment on table public.clinica_multas is
    'Multa do cancelamento em cima da hora, com os parâmetros da política no momento. Isenção exige motivo. Só o servidor escreve.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_agenda() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_agenda() to service_role;

-- ---- o tipo de agendamento tem de ser da mesma organização (gatilho BEFORE INSERT/UPDATE) ----
-- A FK só confere que o tipo existe. Sem isto, uma clínica etiquetaria o tipo de outra.
create or replace function public.fn_clinica_tipo_da_mesma_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  if not exists (
    select 1 from public.calendar_event_types t
     where t.id = new.event_type_id and t.organization_id = new.organization_id
  ) then
    raise exception 'clinica_tipo_de_outra_organizacao' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$f$;

revoke execute on function public.fn_clinica_tipo_da_mesma_org() from public, anon, authenticated;

-- ---- a provisionadora do módulo passa a chamar a da agenda ----
-- Corpo igual ao da 9001, com UMA linha a mais antes das proteções.
create or replace function public.fn_clinica_provisionar()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── quem é profissional de saúde na clínica ──────────────────────────────
  create table if not exists public.clinica_profissionais (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    -- `restrict`: o cadastro é a origem da assinatura dos registros. Quem sai da clínica é
    -- desativado (`ativo = false`), nunca apagado.
    user_id uuid not null references auth.users(id) on delete restrict,

    -- O nome como consta no conselho: é o que vai carimbado em cada registro assinado.
    nome_profissional text not null check (length(btrim(nome_profissional)) between 2 and 200),
    conselho text not null check (conselho in ('CREFITO', 'CRM', 'COREN', 'CREF', 'CRN', 'CRP', 'outro')),
    registro_numero text not null check (length(btrim(registro_numero)) between 1 and 30),
    registro_uf text not null check (registro_uf ~ '^[A-Z]{2}$'),

    modalidades text[] not null check (
      cardinality(modalidades) > 0
      and modalidades <@ array['fisioterapia', 'pilates', 'medicina', 'enfermagem']::text[]
    ),

    ativo boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint clinica_profissionais_um_por_usuario unique (organization_id, user_id)
  );

  create index if not exists clinica_profissionais_org_idx
    on public.clinica_profissionais (organization_id);

  -- ── o registro clínico assinado ───────────────────────────────────────────
  create table if not exists public.prontuario_registros (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,

    -- `restrict`, como conversations.contact_id: apagar o contato não apaga o prontuário.
    contact_id uuid not null references public.contacts(id) on delete restrict,

    -- A sessão da agenda que originou o registro, quando houver. `restrict` e não `set null`:
    -- o registro é imutável, então o compromisso que ele cita não pode sumir debaixo dele.
    appointment_id uuid references public.calendar_appointments(id) on delete restrict,

    modalidade text not null check (modalidade in ('fisioterapia', 'pilates', 'medicina', 'enfermagem')),
    tipo text not null check (tipo in ('anamnese', 'avaliacao', 'evolucao', 'alta', 'adendo')),

    adendo_de uuid references public.prontuario_registros(id) on delete restrict,
    constraint prontuario_registros_adendo_aponta_o_original check (
      (tipo = 'adendo') = (adendo_de is not null)
    ),

    -- O que o modelo da modalidade estrutura (dor 0–10, sinais vitais, condutas…).
    conteudo jsonb not null default '{}'::jsonb check (jsonb_typeof(conteudo) = 'object'),
    texto text check (texto is null or length(texto) <= 20000),
    constraint prontuario_registros_tem_conteudo check (
      conteudo <> '{}'::jsonb or nullif(btrim(texto), '') is not null
    ),

    -- A assinatura, carimbada pelo gatilho a partir de `clinica_profissionais`. É cópia de
    -- propósito (DIRC: duplicar com fonte declarada): o registro tem de dizer quem assinou
    -- mesmo depois de o cadastro mudar.
    autor_user_id uuid references auth.users(id) on delete set null,
    autor_nome text not null,
    autor_registro text not null,
    assinado_em timestamptz not null default now(),

    created_at timestamptz not null default now()
  );

  create index if not exists prontuario_registros_paciente_idx
    on public.prontuario_registros (organization_id, contact_id, assinado_em desc);
  create index if not exists prontuario_registros_compromisso_idx
    on public.prontuario_registros (organization_id, appointment_id) where appointment_id is not null;
  create index if not exists prontuario_registros_adendo_idx
    on public.prontuario_registros (adendo_de) where adendo_de is not null;

  drop trigger if exists trg_prontuario_carimbar_registro on public.prontuario_registros;
  create trigger trg_prontuario_carimbar_registro
    before insert on public.prontuario_registros
    for each row execute function public.fn_prontuario_carimbar_registro();

  drop trigger if exists trg_prontuario_registro_imutavel on public.prontuario_registros;
  create trigger trg_prontuario_registro_imutavel
    before update or delete on public.prontuario_registros
    for each row execute function public.fn_prontuario_registro_imutavel();

  -- ── quem abriu o prontuário de quem ───────────────────────────────────────
  create table if not exists public.prontuario_acessos (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    contact_id uuid not null references public.contacts(id) on delete restrict,
    user_id uuid references auth.users(id) on delete set null,
    acessado_em timestamptz not null default now()
  );

  create index if not exists prontuario_acessos_paciente_idx
    on public.prontuario_acessos (organization_id, contact_id, acessado_em desc);

  drop trigger if exists trg_prontuario_carimbar_acesso on public.prontuario_acessos;
  create trigger trg_prontuario_carimbar_acesso
    before insert on public.prontuario_acessos
    for each row execute function public.fn_prontuario_carimbar_acesso();

  -- ── RLS por operação, ligada aqui (D5) ────────────────────────────────────
  -- Cada `create policy` deste corpo ocupa DUAS linhas de propósito (#1906, mesmo cuidado da
  -- 0480): o `update.sh` de v1.39.0 a v1.63.0 lê as regras do TEXTO do baseline, até dentro de
  -- corpo de função, e cobraria estas regras em instalação sem o módulo.
  --   clinica_profissionais  SELECT membro · INSERT/UPDATE admin · DELETE ninguém
  --   prontuario_registros   SELECT/INSERT profissional ativo · UPDATE/DELETE ninguém
  --   prontuario_acessos     SELECT admin · INSERT profissional ativo · UPDATE/DELETE ninguém
  alter table public.clinica_profissionais enable row level security;
  drop policy if exists tenant_isolation_clinica_profissionais_all on public.clinica_profissionais;

  drop policy if exists clinica_profissionais_select on public.clinica_profissionais;
  create policy clinica_profissionais_select
    on public.clinica_profissionais
    for select using (organization_id in (select public.fn_user_org_ids()));

  drop policy if exists clinica_profissionais_insert on public.clinica_profissionais;
  create policy clinica_profissionais_insert
    on public.clinica_profissionais
    for insert
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));

  drop policy if exists clinica_profissionais_update on public.clinica_profissionais;
  create policy clinica_profissionais_update
    on public.clinica_profissionais
    for update
    using (organization_id in (select public.fn_user_org_ids())
           and public.fn_role_at_least(organization_id, 'admin'))
    with check (organization_id in (select public.fn_user_org_ids())
                and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_profissionais from anon;

  alter table public.prontuario_registros enable row level security;
  drop policy if exists tenant_isolation_prontuario_registros_all on public.prontuario_registros;

  drop policy if exists prontuario_registros_select on public.prontuario_registros;
  create policy prontuario_registros_select
    on public.prontuario_registros
    for select using (public.fn_clinica_e_profissional(organization_id));

  drop policy if exists prontuario_registros_insert on public.prontuario_registros;
  create policy prontuario_registros_insert
    on public.prontuario_registros
    for insert
    with check (public.fn_clinica_e_profissional(organization_id)
                and autor_user_id = auth.uid());
  revoke all on public.prontuario_registros from anon;

  alter table public.prontuario_acessos enable row level security;
  drop policy if exists tenant_isolation_prontuario_acessos_all on public.prontuario_acessos;

  drop policy if exists prontuario_acessos_select on public.prontuario_acessos;
  create policy prontuario_acessos_select
    on public.prontuario_acessos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'));

  drop policy if exists prontuario_acessos_insert on public.prontuario_acessos;
  create policy prontuario_acessos_insert
    on public.prontuario_acessos
    for insert
    with check (public.fn_clinica_e_profissional(organization_id)
                and user_id = auth.uid());
  revoke all on public.prontuario_acessos from anon;

  comment on table public.clinica_profissionais is
    'Profissionais de saúde da clínica (conselho, registro, modalidades). Estar ativo aqui é o que dá acesso ao prontuário; papel da organização não basta.';
  comment on table public.prontuario_registros is
    'Registro clínico assinado (anamnese, avaliação, evolução, alta, adendo). Imutável: correção é adendo. Fora da anonimização por obrigação legal de guarda (20 anos).';
  comment on table public.prontuario_acessos is
    'Trilha de quem abriu o prontuário de qual paciente. Só o admin lê; ninguém edita.';

  -- A agenda da clínica (migration 9002), antes das proteções.
  perform public.fn_clinica_provisionar_agenda();

  -- RLS já ligada por nós: a rotina não as toca mais, só aplica as travas de suporte (D5).
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar() to service_role;
