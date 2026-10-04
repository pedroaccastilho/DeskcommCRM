-- 9008 — Clínica: os perfis (cargos) de cada usuário, escolhidos no cadastro, e somados.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (2026-10-04):
--  - o cadastro do profissional de saúde sai de uma tela separada (Configurações › Profissionais
--    de saúde) e vai para o cadastro do usuário, que só o administrador da clínica faz. Ao
--    escolher "Médico", a pessoa já entra com tudo o que um médico vê e faz;
--  - TODO usuário pode ter mais de um perfil, e o acesso é a soma das funções de cada um (ex.: uma
--    pessoa que é do jurídico, do financeiro e gerente; um gerente que também é fisioterapeuta);
--  - dois perfis novos: Jurídico e Financeiro.
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_cargos_membro` — os perfis de cada membro, uma linha por perfil. O vocabulário é do
--    módulo (`lib/clinica/cargos.ts`). Escolher os perfis também grava o que o sistema já sabia
--    ler: o papel do núcleo (o maior que os perfis pedem), o menu da interface atual e o cadastro
--    em `clinica_profissionais` para o perfil de saúde (no máximo um: o cadastro tem um conselho).
--    Quem não tem linha ainda (todo mundo antes desta migration) tem os perfis CALCULADOS do papel
--    e do cadastro de profissional, então nada se perde e ninguém muda de acesso ao atualizar.
-- 2. `clinica_convites_cargos` — os perfis e o registro do conselho que o administrador escolheu
--    ao convidar, guardados até a pessoa aceitar (a conta ainda não existe no convite). No aceite,
--    o servidor (`lib/clinica/cargo-do-convite.ts`, chamado por `lib/auth/aplicar-convite.ts`)
--    grava os perfis e cria o cadastro de profissional. Uma linha por convite, apagada com ele.
--
-- ── Por que recriar a provisionadora das origens ────────────────────────────────────────────
-- A nova `fn_clinica_provisionar_cargos()` é chamada, protegida, no fim de
-- `fn_clinica_provisionar_origens()` (9005), recriada aqui com o mesmo corpo e essa chamada a
-- mais. A 9007 (outra frente) recria `fn_clinica_provisionar_pacotes()`; esta não toca nela, então
-- a ordem de mesclagem não importa.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabelas e funções do módulo. Sem o módulo, papel e convite do núcleo seguem como sempre.

-- ---- a provisionadora dos perfis ----
create or replace function public.fn_clinica_provisionar_cargos()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  -- ── os perfis de cada membro ──────────────────────────────────────────────
  create table if not exists public.clinica_cargos_membro (
    organization_id uuid not null references public.organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    cargo text not null check (cargo in (
      'administrador', 'gerente', 'financeiro', 'juridico', 'recepcao',
      'medico', 'fisioterapeuta', 'enfermeiro', 'educador'
    )),
    definido_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (organization_id, user_id, cargo)
  );

  -- ── os perfis do convite, até o aceite ────────────────────────────────────
  create table if not exists public.clinica_convites_cargos (
    -- O convite do núcleo (migration 0238). Reconvidar renova a mesma linha de convite, e esta
    -- acompanha; aceitar consome.
    invite_id uuid primary key references public.team_invites(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    cargos text[] not null check (
      cardinality(cargos) > 0
      and cargos <@ array[
        'administrador', 'gerente', 'financeiro', 'juridico', 'recepcao',
        'medico', 'fisioterapeuta', 'enfermeiro', 'educador'
      ]::text[]
    ),
    -- O registro do conselho, quando há perfil de saúde (a rota cobra os três juntos).
    nome_profissional text check (nome_profissional is null or length(btrim(nome_profissional)) between 2 and 200),
    registro_numero text check (registro_numero is null or length(btrim(registro_numero)) between 1 and 30),
    registro_uf text check (registro_uf is null or registro_uf ~ '^[A-Z]{2}$'),
    criado_por uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create index if not exists clinica_convites_cargos_org_idx
    on public.clinica_convites_cargos (organization_id);

  -- ── RLS ───────────────────────────────────────────────────────────────────
  -- Os perfis de cada um: todo membro lê (a tela de cada um se monta por eles). Os do convite: só
  -- o administrador. As duas só o servidor escreve, depois de conferir o papel de quem pede.
  alter table public.clinica_cargos_membro enable row level security;
  drop policy if exists clinica_cargos_membro_select on public.clinica_cargos_membro;
  create policy clinica_cargos_membro_select
    on public.clinica_cargos_membro
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_cargos_membro from anon;

  alter table public.clinica_convites_cargos enable row level security;
  drop policy if exists clinica_convites_cargos_select on public.clinica_convites_cargos;
  create policy clinica_convites_cargos_select
    on public.clinica_convites_cargos
    for select using (organization_id in (select public.fn_user_org_ids())
                      and public.fn_role_at_least(organization_id, 'admin'));
  revoke all on public.clinica_convites_cargos from anon;

  comment on table public.clinica_cargos_membro is
    'Perfis de cada membro da clínica (um por linha; a pessoa soma as funções de todos). Sem linha, os perfis são calculados do papel e de clinica_profissionais. Só o servidor escreve.';
  comment on table public.clinica_convites_cargos is
    'Perfis e registro do conselho escolhidos pelo administrador ao convidar; no aceite viram clinica_cargos_membro e clinica_profissionais. Só o servidor escreve.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_cargos() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_cargos() to service_role;

-- ---- a provisionadora das origens passa a chamar a dos perfis ----
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

  -- Os perfis de cada usuário (migration 9008, fork TOQ): os escolhidos pelo administrador
  -- no cadastro e no convite. Chamada protegida: sem a 9008 nada
  -- acontece, e quem recriar esta função depois mantém a chamada.
  if to_regprocedure('public.fn_clinica_provisionar_cargos()') is not null then
    execute 'select public.fn_clinica_provisionar_cargos()';
  end if;
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_origens() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_origens() to service_role;
