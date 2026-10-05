-- 9007 — Clínica: as etapas da sessão no dia ("chegou" e "em atendimento").
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- A recepção precisa ver, na grade do dia, quem já chegou e quem já está sendo atendido. O
-- núcleo não tem esses estados: `calendar_appointments.status` vai de "aguardando confirmação"
-- ou "confirmado" direto para "realizado" ou "não compareceu", e pôr dois valores novos no CHECK
-- do núcleo mudaria a agenda de toda instalação (D4: a provisionadora não mexe no núcleo).
--
-- Então a etapa mora numa tabela do módulo, `clinica_sessao_etapas`, uma linha por sessão:
-- - `chegou_em` / `chegou_por_user_id` — quando a recepção marcou a chegada, e quem marcou;
-- - `atendimento_iniciado_em` / `atendimento_iniciado_por_user_id` — quando o atendimento
--   começou, e quem marcou. Não existe atendimento sem chegada (CHECK).
-- Sem linha = a sessão ainda não teve etapa nenhuma. "Desfazer" limpa as duas.
--
-- ── Quem escreve ─────────────────────────────────────────────────────────────────────────────
-- Só o servidor, pela rota `POST /api/v1/clinica/agenda/[id]/etapa` (`agent`+), que confere o
-- papel, a organização da sessão e se ela é da clínica e ainda está em aberto. Não há policy
-- de escrita para a sessão: ninguém marca chegada pela API REST do Supabase pulando essas
-- conferências. A leitura é de qualquer membro, como a grade (não há dado clínico aqui).
-- Decisão consciente: não é a policy ampla `tenant_isolation_<tabela>_all`, que deixaria
-- "Somente leitura" gravar pela REST; segue o desenho de leitura e escrita das tabelas da 9004.
--
-- ── Por que recriar a provisionadora dos pacotes, e não a do módulo ou a da agenda ──────────
-- A provisionadora nova `fn_clinica_provisionar_etapas()` é chamada no FIM de
-- `fn_clinica_provisionar_pacotes()`, recriada aqui com o corpo em vigor (o da 9004) e essa
-- linha a mais. `fn_clinica_provisionar()` e `fn_clinica_provisionar_agenda()` não são tocadas:
-- outras frentes as recriam, e duas recriações da mesma função em PRs paralelos se
-- sobrescreveriam. A cadeia fica: módulo → agenda → pacotes → (origens) → etapas → proteções.
--
-- A 9005 (origem do paciente, outra frente) TAMBÉM recria `fn_clinica_provisionar_pacotes()`
-- para chamar `fn_clinica_provisionar_origens()`. Para que a ordem de merge não apague a chamada
-- de ninguém, esta recriação termina com as DUAS: a das origens guardada por `to_regprocedure`
-- (a 9005 pode ainda não estar nesta versão) e a das etapas.
--
-- ── Onde o módulo já está instalado ─────────────────────────────────────────────────────────
-- No kit, o apêndice do baseline reaplica os módulos instalados (`fn_reaplicar_modulos_instalados`)
-- depois deste bloco, e a tabela nasce ali. Para quem aplica pela cadeia de migrations, o bloco
-- `do` do fim chama a provisionadora do MÓDULO (a cadeia inteira, com as proteções e as travas
-- do suporte) quando `modulos_instalados` diz que a clínica está ativa. Idempotente.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só uma tabela e funções do módulo. Sem o módulo instalado, nada disto existe, e a agenda do
-- núcleo não muda: a grade da clínica devolve as etapas como `null` quando a tabela não existe.

-- ---- a provisionadora das etapas da sessão ----
create or replace function public.fn_clinica_provisionar_etapas()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
begin
  create table if not exists public.clinica_sessao_etapas (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    -- `cascade`: a etapa só existe enquanto a sessão existe; não é registro que sobreviva a ela.
    appointment_id uuid not null references public.calendar_appointments(id) on delete cascade,
    chegou_em timestamptz,
    chegou_por_user_id uuid references auth.users(id) on delete set null,
    atendimento_iniciado_em timestamptz,
    atendimento_iniciado_por_user_id uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint clinica_sessao_etapas_uma_por_sessao unique (organization_id, appointment_id),
    constraint clinica_sessao_etapas_atendimento_depois_da_chegada check (
      atendimento_iniciado_em is null or chegou_em is not null
    )
  );

  create index if not exists clinica_sessao_etapas_appointment_idx
    on public.clinica_sessao_etapas (appointment_id);

  -- ── RLS ───────────────────────────────────────────────────────────────────
  -- Leitura de qualquer membro (a grade é de `viewer`+). Sem policy de escrita: só o servidor.
  alter table public.clinica_sessao_etapas enable row level security;
  drop policy if exists clinica_sessao_etapas_select on public.clinica_sessao_etapas;
  create policy clinica_sessao_etapas_select
    on public.clinica_sessao_etapas
    for select using (organization_id in (select public.fn_user_org_ids()));
  revoke all on public.clinica_sessao_etapas from anon;

  comment on table public.clinica_sessao_etapas is
    'Etapa da sessão no dia: quando o paciente chegou e quando o atendimento começou, e quem marcou. Uma linha por sessão. Só o servidor escreve, pela rota /api/v1/clinica/agenda/[id]/etapa.';
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_etapas() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_etapas() to service_role;

-- ---- a provisionadora dos pacotes passa a chamar a das etapas (9007) ----
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

  -- A origem do paciente (migration 9005), quando ela já existe nesta versão: a 9005 também
  -- recria esta função para chamá-la, e quem fosse mesclado por último apagaria a chamada do
  -- outro. Por isso as duas chamadas moram aqui, a da 9005 guardada pela existência.
  if to_regprocedure('public.fn_clinica_provisionar_origens()') is not null then
    execute 'select public.fn_clinica_provisionar_origens()';
  end if;

  -- As etapas da sessão (migration 9007), depois dos pacotes.
  perform public.fn_clinica_provisionar_etapas();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_pacotes() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_pacotes() to service_role;

-- ---- onde a clínica já está instalada, provisiona agora (só na cadeia de migrations) ----
-- `to_regclass`: numa cadeia anterior à 0340 a tabela de módulos instalados não existe.
do $m$
begin
  if to_regclass('public.modulos_instalados') is not null
     and exists (select 1 from public.modulos_instalados
                  where modulo = 'clinica' and estado = 'ativo') then
    perform public.fn_clinica_provisionar();
  end if;
end
$m$;
