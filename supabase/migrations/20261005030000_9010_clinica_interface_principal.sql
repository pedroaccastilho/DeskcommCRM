-- 9010 — Clínica: a interface nova vira a principal de quem não administra (decisão da
-- organização, ligada pelo Administrador).
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (2026-10-04): "os perfis que não são de administradores nem terão a visão
-- antiga do sistema"; só o Administrador alterna entre as duas interfaces.
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- Uma coluna em `clinica_politicas` (uma linha por organização, escrita só pelo Administrador):
-- `interface_nova_principal boolean not null default false`. Ligada, quem não é Administrador e
-- abre uma tela da interface atual que tem equivalente na nova é levado para ela
-- (`lib/novo/raiz.ts`, no layout de `/app`).
--
-- ── Por que é uma escolha, e desligada por padrão ───────────────────────────────────────────
-- Instalar o módulo não pode mudar sozinho a tela de quem já trabalha na interface atual: a
-- organização decide o uso (doutrina de extensões, regra 3). E a escolha mora no módulo, não em
-- `organizations.settings`: sem o módulo ela não existe.
--
-- ── Como entra ──────────────────────────────────────────────────────────────────────────────
-- Provisionadora nova `fn_clinica_provisionar_interface()`, chamada no fim de
-- `fn_clinica_provisionar_etapas()` (9007), recriada aqui com o corpo em vigor e essa linha a
-- mais: é a folha da cadeia que nenhuma outra frente está recriando. Onde o módulo já está
-- instalado, o bloco `do` do fim aplica a coluna na hora (o kit reaplica os módulos depois do
-- apêndice, pelo mesmo caminho).
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só uma coluna e funções do módulo. Sem o módulo, a interface atual segue como sempre.

-- ---- a provisionadora da escolha da interface ----
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
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_interface() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_interface() to service_role;

-- ---- a provisionadora das etapas passa a chamar a da interface (9010) ----
-- O corpo é o da 9007, sem mudança, mais a última linha. Idempotente como antes.
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

  -- A interface nova como a principal da equipe (migration 9010).
  perform public.fn_clinica_provisionar_interface();
end;
$f$;

revoke execute on function public.fn_clinica_provisionar_etapas() from public, anon, authenticated;
grant execute on function public.fn_clinica_provisionar_etapas() to service_role;

-- ---- onde o módulo já está instalado ----
do $do$
begin
  if to_regclass('public.clinica_politicas') is not null then
    perform public.fn_clinica_provisionar_interface();
  end if;
end;
$do$;
