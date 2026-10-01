-- 9001 — Clínica: o prontuário clínico como módulo oficial da ADR-0002 (fork TOQ).
--
-- Numeração: as migrations deste fork usam a faixa 9xxx para não colidir com a numeração
-- do projeto original (melgarafael/DeskcommCRM), que este fork continua puxando.
--
-- Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md. Molde: a 0480 (honorários).
--
-- ── D2: a migration cria FUNÇÕES, nunca tabela ───────────────────────────────────────────────
-- `public.fn_clinica_provisionar()` guarda o schema de `clinica_profissionais`,
-- `prontuario_registros` e `prontuario_acessos`. As tabelas só nascem quando o administrador
-- da instalação instala o módulo (`fn_modulo_instalar('clinica', ...)`).
--
-- ── Destino (DoD 18): extensão ────────────────────────────────────────────────────────────────
-- Prontuário é especialização de clínica. Sem ele, funil, agenda e atendimento continuam
-- inteiros. O módulo REFERENCIA o núcleo (contato, compromisso da agenda) e não duplica nada
-- dele.
--
-- ── As regras clínicas que moram no banco, e não só na tela ─────────────────────────────────
-- 1. QUEM LÊ é profissional de saúde ATIVO cadastrado em `clinica_profissionais` e ainda
--    membro da organização. Papel (`viewer`…`admin`) não basta: a recepção pode ser `manager`
--    e não lê prontuário. `fn_clinica_e_profissional(org)` é a régua única das policies.
-- 2. SESSÃO DE SUPORTE NÃO LÊ. O modo suporte da plataforma faz o operador da instalação
--    "entrar" na organização (fn_user_org_ids inclui a org do suporte, e fn_user_role_in_org
--    devolve `admin`). Para prontuário isso fica fechado: com contexto de suporte ativo a
--    régua devolve false, mesmo que o operador também esteja cadastrado como profissional.
--    E não há a cláusula `or fn_is_platform_admin()` que honorários tem.
-- 3. ASSINADO NÃO MUDA. Não há policy de UPDATE nem de DELETE, e gatilhos recusam os dois
--    também para quem passa por fora da RLS (service_role, dono). Correção é ADENDO: um
--    registro novo com `tipo = 'adendo'` apontando o original (CFM 1.638/2002, COFFITO 414/2012).
--    A única remoção aceita é a cascata da própria organização sendo excluída.
-- 4. A ASSINATURA é carimbada pelo banco: `autor_nome`, `autor_registro` e `assinado_em` vêm
--    do cadastro do profissional e de `now()` no gatilho de inserção, nunca do corpo da
--    requisição. Quem escreve só pode escrever como si mesmo (`autor_user_id = auth.uid()`),
--    numa modalidade que atende.
-- 5. TODA ABERTURA fica em `prontuario_acessos`, que só o `admin` da organização lê e que
--    ninguém edita ou apaga pela sessão.
--
-- ── LGPD (D8) ─────────────────────────────────────────────────────────────────────────────────
-- O prontuário NÃO entra em `modulo_secoes_lgpd`: anonimizar o contato não redige o prontuário,
-- de propósito. A guarda mínima é de 20 anos (Lei 13.787/2018, art. 6º; CFM 1.821/2007), e a
-- LGPD autoriza conservar dado para cumprir obrigação legal (art. 16, I). O direito de acesso
-- (exportação para o paciente) entra na entrega de telas do módulo.
--
-- ── IA ────────────────────────────────────────────────────────────────────────────────────────
-- Nenhuma ferramenta do agente lê estas tabelas. O motor usa o service_role, que passa por fora
-- da RLS, então a garantia é não existir ferramenta — vigiada por invariante próprio.

-- ---- a provisionadora (ADR-0002 D2/D4/D5) ----
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

  -- RLS já ligada por nós: a rotina não as toca mais, só aplica as travas de suporte (D5).
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

-- D4: as DUAS origens de EXECUTE.
revoke execute on function public.fn_clinica_provisionar() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar() to service_role;

-- ---- a régua única das policies do prontuário ----
--
-- PL/pgSQL e não SQL: compila sem a tabela existir (ADR-0002 D7). `security definer` porque
-- precisa ler `clinica_profissionais` e `user_organizations` independentemente da RLS de quem
-- consulta; o único efeito é responder sobre o próprio `auth.uid()`.
create or replace function public.fn_clinica_e_profissional(p_org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
begin
  if auth.uid() is null or p_org is null then
    return false;
  end if;
  if coalesce(public.fn_support_context() ->> 'status', '') = 'active' then
    return false;
  end if;
  if to_regclass('public.clinica_profissionais') is null then
    return false;
  end if;
  return exists (
    select 1
      from public.clinica_profissionais p
      join public.user_organizations uo
        on uo.user_id = p.user_id
       and uo.organization_id = p.organization_id
       and uo.revoked_at is null
     where p.organization_id = p_org
       and p.user_id = auth.uid()
       and p.ativo
  );
end;
$f$;

revoke execute on function public.fn_clinica_e_profissional(uuid) from public, anon;
grant execute on function public.fn_clinica_e_profissional(uuid) to authenticated, service_role;

-- ---- carimbo e integridade do registro clínico (gatilho BEFORE INSERT) ----
--
-- `security definer` porque confere contato e compromisso pela organização, sem depender do
-- escopo de visualização de quem escreve (um profissional `agent` pode não enxergar o contato
-- pela RLS de contatos e, mesmo assim, atendê-lo). Sem parâmetro: só roda como gatilho.
create or replace function public.fn_prontuario_carimbar_registro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_prof record;
  v_orig record;
begin
  new.assinado_em := now();
  new.created_at := now();

  if not exists (
    select 1 from public.contacts c
     where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then
    raise exception 'prontuario_contato_de_outra_organizacao' using errcode = '22023';
  end if;

  if new.appointment_id is not null and not exists (
    select 1 from public.calendar_appointments a
     where a.id = new.appointment_id
       and a.organization_id = new.organization_id
       and a.contact_id = new.contact_id
  ) then
    raise exception 'prontuario_compromisso_nao_e_do_paciente' using errcode = '22023';
  end if;

  if new.adendo_de is not null then
    select r.organization_id, r.contact_id into v_orig
      from public.prontuario_registros r
     where r.id = new.adendo_de;
    if not found
       or v_orig.organization_id <> new.organization_id
       or v_orig.contact_id <> new.contact_id then
      raise exception 'prontuario_adendo_de_outro_paciente' using errcode = '22023';
    end if;
  end if;

  -- Sessão de usuário: a assinatura é a do cadastro de quem está logado, sempre.
  if auth.uid() is not null then
    if new.autor_user_id is distinct from auth.uid() then
      raise exception 'prontuario_autor_nao_e_quem_assina' using errcode = '42501';
    end if;
    select p.nome_profissional, p.conselho, p.registro_numero, p.registro_uf, p.modalidades
      into v_prof
      from public.clinica_profissionais p
     where p.organization_id = new.organization_id
       and p.user_id = auth.uid()
       and p.ativo;
    if not found then
      raise exception 'prontuario_sem_cadastro_de_profissional' using errcode = '42501';
    end if;
    if not (new.modalidade = any (v_prof.modalidades)) then
      raise exception 'prontuario_modalidade_fora_do_cadastro' using errcode = '42501';
    end if;
    new.autor_nome := v_prof.nome_profissional;
    new.autor_registro := v_prof.conselho || '-' || v_prof.registro_uf || ' ' || v_prof.registro_numero;
  end if;

  return new;
end;
$f$;

revoke execute on function public.fn_prontuario_carimbar_registro() from public, anon, authenticated;

-- ---- registro assinado é imutável (gatilho BEFORE UPDATE / BEFORE DELETE) ----
--
-- Vale para TODO papel, service_role e dono inclusive: a RLS sozinha não alcança quem passa
-- por fora dela. A única remoção aceita é a cascata da organização excluída — quando o
-- gatilho do filho roda, a linha da organização já não existe.
create or replace function public.fn_prontuario_registro_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
      return old;
    end if;
    raise exception 'prontuario_registro_imutavel' using
      errcode = '42501',
      hint = 'Registro assinado não se apaga. Para corrigir, crie um adendo.';
  end if;
  raise exception 'prontuario_registro_imutavel' using
    errcode = '42501',
    hint = 'Registro assinado não se edita. Para corrigir, crie um adendo.';
end;
$f$;

revoke execute on function public.fn_prontuario_registro_imutavel() from public, anon, authenticated;

-- ---- carimbo do acesso (gatilho BEFORE INSERT) ----
create or replace function public.fn_prontuario_carimbar_acesso()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $f$
begin
  new.acessado_em := now();
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$f$;

revoke execute on function public.fn_prontuario_carimbar_acesso() from public, anon, authenticated;
