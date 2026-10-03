-- 9006 — Clínica: o plano de tratamento que sai da avaliação, e o retorno de reavaliação.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (02/10/2026), item "Plano de tratamento" do backlog do PO: sessões previstas,
-- "sessão 6 de 10" e o retorno de reavaliação já agendado na data que o avaliador escolheu.
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- 1. `clinica_planos_tratamento`: uma linha por avaliação assinada que traz plano (sessões
--    previstas, frequência semanal ou data da reavaliação). É o PEDAÇO NÃO CLÍNICO da avaliação,
--    copiado de propósito (DIRC: duplicar com fonte declarada): o prontuário só o profissional
--    lê, e o plano a recepção também precisa ver para marcar as sessões. Objetivos, diagnóstico
--    e condutas NUNCA vêm para cá.
-- 2. Quem escreve o plano é o BANCO, num gatilho AFTER INSERT em `prontuario_registros`: ao
--    assinar uma avaliação com plano, o plano anterior da mesma modalidade vira `substituido` e
--    nasce o novo; ao assinar uma alta, o plano ativo da modalidade vira `alta`. Assim não há
--    plano sem avaliação assinada por trás, e ninguém fabrica um pela API REST do Supabase.
-- 3. O retorno: o gatilho só marca `retorno_situacao = 'a_marcar'`. Quem procura o horário na
--    agenda do avaliador e marca é o servidor (`lib/clinica/retorno-agendado.ts`), logo depois
--    de a avaliação ser assinada, porque a regra de horário livre mora no TypeScript do núcleo.
--    O resultado (marcado no dia, marcado em outro dia, sem horário, sem tipo) e o aviso ao
--    paciente pelo WhatsApp voltam para esta linha pelo servidor (service_role).
--
-- ── Quem lê e quem escreve ──────────────────────────────────────────────────────────────────
-- SELECT: todo membro da organização (profissionais e recepção). Sem policy de escrita para a
-- sessão: só o gatilho e o servidor.
--
-- ── Por que recriar a provisionadora do módulo ──────────────────────────────────────────────
-- O gatilho fica em `prontuario_registros`, então a auxiliar do plano tem de rodar DEPOIS das
-- tabelas do prontuário. `fn_clinica_provisionar()` ganha uma linha (a chamada da auxiliar),
-- logo depois da auxiliar da agenda. O resto do corpo é o da 9002, sem mudança.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só tabela e gatilho do módulo. Sem o módulo instalado, nada disto existe.

-- ---- a provisionadora auxiliar do plano de tratamento ----
create or replace function public.fn_clinica_provisionar_plano()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.clinica_planos_tratamento (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `restrict`, como o prontuário: apagar o contato não apaga o plano que veio dele.
    contact_id uuid not null references public.contacts(id) on delete restrict,
    modalidade text not null
      check (modalidade in ('fisioterapia', 'pilates', 'medicina', 'enfermagem')),

    -- A avaliação assinada de onde o plano saiu. Uma avaliação, um plano.
    avaliacao_id uuid not null references public.prontuario_registros(id) on delete restrict,
    -- A sessão da agenda em que a avaliação foi feita: não conta como sessão do plano.
    avaliacao_appointment_id uuid references public.calendar_appointments(id) on delete set null,
    avaliador_user_id uuid references auth.users(id) on delete set null,
    avaliador_nome text not null,

    sessoes_previstas int check (sessoes_previstas is null or sessoes_previstas between 1 and 200),
    frequencia_semanal int check (frequencia_semanal is null or frequencia_semanal between 1 and 14),
    reavaliacao_em date,

    -- ativo: vale agora · substituido: uma avaliação nova da mesma modalidade tomou o lugar ·
    -- alta: a alta da modalidade foi assinada.
    situacao text not null default 'ativo'
      check (situacao in ('ativo', 'substituido', 'alta')),
    alta_motivo text
      check (alta_motivo is null or alta_motivo in ('objetivo_atingido', 'encaminhado', 'abandono', 'a_pedido')),
    encerrado_em timestamptz,

    -- O retorno de reavaliação. `nao_pedido`: a avaliação não trouxe data. `a_marcar`: trouxe, e
    -- o servidor ainda não marcou. `marcado`: no dia pedido. `marcado_outro_dia`: o dia estava
    -- cheio e o sistema reservou o horário livre mais próximo (a recepção é avisada).
    -- `sem_horario` e `sem_tipo`: não deu para marcar (a recepção é avisada).
    retorno_situacao text not null default 'nao_pedido'
      check (retorno_situacao in ('nao_pedido', 'a_marcar', 'marcado', 'marcado_outro_dia', 'sem_horario', 'sem_tipo')),
    retorno_appointment_id uuid references public.calendar_appointments(id) on delete set null,
    -- A confirmação ao paciente pelo WhatsApp.
    retorno_aviso text not null default 'nao_enviado'
      check (retorno_aviso in ('nao_enviado', 'enviado', 'nao_deu')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint clinica_planos_tratamento_uma_por_avaliacao unique (avaliacao_id),
    constraint clinica_planos_tratamento_encerrado_tem_data check (
      (situacao = 'ativo') = (encerrado_em is null)
    )
  );

  -- Um plano ativo por paciente e modalidade.
  create unique index if not exists clinica_planos_tratamento_um_ativo
    on public.clinica_planos_tratamento (organization_id, contact_id, modalidade)
    where situacao = 'ativo';
  create index if not exists clinica_planos_tratamento_paciente_idx
    on public.clinica_planos_tratamento (organization_id, contact_id, created_at desc);

  drop trigger if exists trg_clinica_plano_do_registro on public.prontuario_registros;
  create trigger trg_clinica_plano_do_registro
    after insert on public.prontuario_registros
    for each row execute function public.fn_clinica_plano_do_registro();

  alter table public.clinica_planos_tratamento enable row level security;
  drop policy if exists clinica_planos_tratamento_select on public.clinica_planos_tratamento;
  create policy clinica_planos_tratamento_select
    on public.clinica_planos_tratamento
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_planos_tratamento from anon;

  comment on table public.clinica_planos_tratamento is
    'Plano de tratamento que sai da avaliação assinada (sessões previstas, frequência, data da reavaliação) e o retorno marcado. Só o pedaço não clínico. Escrito pelo gatilho do prontuário e pelo servidor.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_plano() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_plano() to service_role;

-- ---- o plano nasce da avaliação e fecha na alta (gatilho AFTER INSERT do prontuário) ----
--
-- `security definer` porque escreve numa tabela sem policy de escrita para a sessão: quem assina
-- é o profissional logado, e o plano é consequência da assinatura, não um pedido dele. Sem
-- parâmetro: só roda como gatilho. Lê só as três chaves do plano no conteúdo; número ou data
-- fora do formato viram NULL, nunca erro (a assinatura não pode falhar por causa do plano).
create or replace function public.fn_clinica_plano_do_registro()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  v_sessoes int;
  v_frequencia int;
  v_reavaliacao date;
  v_bruto text;
begin
  if new.tipo = 'avaliacao' then
    v_bruto := btrim(coalesce(new.conteudo ->> 'numero_de_sessoes', ''));
    if v_bruto ~ '^[0-9]{1,3}([.,]0+)?$' then
      v_sessoes := split_part(replace(v_bruto, ',', '.'), '.', 1)::int;
      if v_sessoes not between 1 and 200 then v_sessoes := null; end if;
    end if;

    v_bruto := btrim(coalesce(new.conteudo ->> 'frequencia_semanal', ''));
    if v_bruto ~ '^[0-9]{1,2}([.,]0+)?$' then
      v_frequencia := split_part(replace(v_bruto, ',', '.'), '.', 1)::int;
      if v_frequencia not between 1 and 14 then v_frequencia := null; end if;
    end if;

    v_bruto := btrim(coalesce(new.conteudo ->> 'data_reavaliacao', ''));
    if v_bruto ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_reavaliacao := v_bruto::date;
      exception when others then
        v_reavaliacao := null;
      end;
    end if;

    if v_sessoes is null and v_frequencia is null and v_reavaliacao is null then
      return null;
    end if;

    update public.clinica_planos_tratamento
       set situacao = 'substituido', encerrado_em = now(), updated_at = now()
     where organization_id = new.organization_id
       and contact_id = new.contact_id
       and modalidade = new.modalidade
       and situacao = 'ativo';

    insert into public.clinica_planos_tratamento (
      organization_id, contact_id, modalidade, avaliacao_id, avaliacao_appointment_id,
      avaliador_user_id, avaliador_nome, sessoes_previstas, frequencia_semanal, reavaliacao_em,
      retorno_situacao
    ) values (
      new.organization_id, new.contact_id, new.modalidade, new.id, new.appointment_id,
      new.autor_user_id, new.autor_nome, v_sessoes, v_frequencia, v_reavaliacao,
      case when v_reavaliacao is null then 'nao_pedido' else 'a_marcar' end
    );
  elsif new.tipo = 'alta' then
    update public.clinica_planos_tratamento
       set situacao = 'alta',
           encerrado_em = now(),
           alta_motivo = case
             when new.conteudo ->> 'motivo' in ('objetivo_atingido', 'encaminhado', 'abandono', 'a_pedido')
               then new.conteudo ->> 'motivo'
           end,
           updated_at = now()
     where organization_id = new.organization_id
       and contact_id = new.contact_id
       and modalidade = new.modalidade
       and situacao = 'ativo';
  end if;
  return null;
end;
$f$;

revoke execute on function public.fn_clinica_plano_do_registro() from public, anon, authenticated;

-- ---- a provisionadora do módulo passa a chamar a do plano ----
-- Corpo igual ao da 9002, com UMA linha a mais depois da agenda.
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

  -- O plano de tratamento (migration 9006): depende do prontuário e da agenda.
  perform public.fn_clinica_provisionar_plano();

  -- RLS já ligada por nós: a rotina não as toca mais, só aplica as travas de suporte (D5).
  perform public.fn_proteger_modulo_provisionado();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar() to service_role;
