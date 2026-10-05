-- 9009 — Clínica: o relatório da gestão (como a clínica está andando) e a exportação para a
-- contabilidade.
--
-- Faixa 9xxx do fork TOQ. Lei: docs/adr/0002-tabelas-de-modulo-num-banco-so.md.
-- Pedido do Pedro (2026-10-04): o gerente precisa de relatórios e dashboards de como a clínica
-- está andando, e de exportar para um financeiro externo (contabilidade) por período.
--
-- ── O que muda ──────────────────────────────────────────────────────────────────────────────
-- Só funções de LEITURA, sem tabela nova e sem tocar no núcleo. Todas em plpgsql: uma função
-- `language sql` tem o corpo validado na criação e quebraria o baseline num banco onde o módulo
-- ainda não foi instalado (as tabelas `clinica_*` nascem só na provisionadora).
--
-- 1. `fn_clinica_relatorio_gestao(org, de, ate)` → jsonb com os totais do período: sessões
--    (marcadas, realizadas, faltas, canceladas, em aberto) no total, por modalidade e por
--    profissional; sessões avulsas realizadas (as que não gastaram pacote) com o preço de
--    tabela; pacotes vendidos e cancelados (com o reembolso sugerido); multas geradas por
--    situação; pacientes novos.
-- 2. `fn_clinica_exportar_sessoes`, `fn_clinica_exportar_pacotes`, `fn_clinica_exportar_multas`
--    (org, de, ate) → uma linha por registro, em ordem estável, para o CSV. A rota pagina com
--    `range` (o PostgREST corta em 1000 linhas sem avisar, e uma exportação para a
--    contabilidade com linha faltando é o pior erro possível: parece certa).
--
-- ── Por que a soma mora aqui ────────────────────────────────────────────────────────────────
-- Mesma razão de `fn_relatorio_financeiro` (migration 0244): somar na rota leria no máximo 1000
-- linhas e devolveria um total menor que o verdadeiro, com cara de certo.
--
-- ── O que cada número quer dizer ────────────────────────────────────────────────────────────
-- Sessão da clínica = compromisso cujo tipo tem modalidade (`clinica_tipos_atendimento`), com
-- INÍCIO no período. Pacote vendido = `comprado_em` no período (inclusive os cancelados depois:
-- a venda aconteceu); pacote cancelado = `cancelado_em` no período. Multa = `created_at` no
-- período, contada pela situação de hoje. "Avulsa" = sessão realizada que não consumiu pacote; o
-- valor dela é o preço de tabela do tipo, NÃO é recebimento (o recebimento da avulsa mora na
-- comanda do núcleo).
--
-- ── Quem chama ──────────────────────────────────────────────────────────────────────────────
-- Só o servidor (service_role), com a organização da sessão: `security definer` e revogadas de
-- public, anon e authenticated. A rota exige Gerente para cima.
--
-- ── Destino (DoD 18): extensão ──────────────────────────────────────────────────────────────
-- Só funções do módulo. Sem o módulo instalado, a chamada falha com 42P01 e a rota responde
-- `module_not_installed`.

-- ---- o relatório da gestão ----
create or replace function public.fn_clinica_relatorio_gestao(
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
  v_resultado jsonb;
begin
  with sessoes as (
    select a.id,
           a.status,
           a.owner_user_id,
           a.contact_id,
           t.modalidade,
           et.default_price_cents as preco_cents,
           exists (
             select 1 from public.clinica_pacote_consumos pc
              where pc.organization_id = p_org and pc.appointment_id = a.id
           ) as do_pacote
      from public.calendar_appointments a
      join public.clinica_tipos_atendimento t
        on t.organization_id = p_org and t.event_type_id = a.event_type_id
      left join public.calendar_event_types et on et.id = a.event_type_id
     where a.organization_id = p_org
       and a.starts_at >= p_de
       and a.starts_at < p_ate
  ),
  por_modalidade as (
    select s.modalidade,
           count(*)::int as marcadas,
           count(*) filter (where s.status = 'completed')::int as realizadas,
           count(*) filter (where s.status = 'no_show')::int as faltas,
           count(*) filter (where s.status = 'cancelled')::int as canceladas
      from sessoes s
     group by s.modalidade
  ),
  por_profissional as (
    select s.owner_user_id as user_id,
           max(pr.nome_profissional) as nome,
           count(*)::int as marcadas,
           count(*) filter (where s.status = 'completed')::int as realizadas,
           count(*) filter (where s.status = 'no_show')::int as faltas,
           count(*) filter (where s.status = 'cancelled')::int as canceladas,
           count(distinct s.contact_id) filter (where s.status = 'completed')::int as pacientes
      from sessoes s
      left join public.clinica_profissionais pr
        on pr.organization_id = p_org and pr.user_id = s.owner_user_id
     group by s.owner_user_id
  ),
  vendidos as (
    select p.modalidade, count(*)::int as qtd, coalesce(sum(p.valor_cents), 0)::bigint as valor,
           count(*) filter (where p.valor_cents is null)::int as sem_valor
      from public.clinica_pacotes p
     where p.organization_id = p_org
       and p.comprado_em >= p_de
       and p.comprado_em < p_ate
     group by p.modalidade
  ),
  cancelados as (
    select count(*)::int as qtd,
           coalesce(sum(p.valor_cents), 0)::bigint as valor,
           coalesce(sum((
             select e.valor_cents from public.clinica_pacote_eventos e
              where e.pacote_id = p.id and e.tipo = 'cancelamento'
              order by e.registrado_em desc
              limit 1
           )), 0)::bigint as reembolso
      from public.clinica_pacotes p
     where p.organization_id = p_org
       and p.status = 'cancelado'
       and p.cancelado_em >= p_de
       and p.cancelado_em < p_ate
  ),
  multas as (
    select m.status, count(*)::int as qtd, coalesce(sum(m.valor_cents), 0)::bigint as valor
      from public.clinica_multas m
     where m.organization_id = p_org
       and m.created_at >= p_de
       and m.created_at < p_ate
     group by m.status
  )
  select jsonb_build_object(
    'sessoes', (
      select jsonb_build_object(
        'marcadas', count(*),
        'realizadas', count(*) filter (where s.status = 'completed'),
        'faltas', count(*) filter (where s.status = 'no_show'),
        'canceladas', count(*) filter (where s.status = 'cancelled'),
        'em_aberto', count(*) filter (where s.status in ('pending', 'confirmed')),
        'pacientes_atendidos', count(distinct s.contact_id) filter (where s.status = 'completed'),
        'avulsas_realizadas', count(*) filter (where s.status = 'completed' and not s.do_pacote),
        'avulsas_valor_tabela_cents',
          coalesce(sum(s.preco_cents) filter (where s.status = 'completed' and not s.do_pacote), 0),
        'avulsas_sem_preco',
          count(*) filter (where s.status = 'completed' and not s.do_pacote and s.preco_cents is null)
      )
      from sessoes s
    ),
    'por_modalidade', coalesce((
      select jsonb_agg(to_jsonb(pm) order by pm.marcadas desc, pm.modalidade) from por_modalidade pm
    ), '[]'::jsonb),
    'por_profissional', coalesce((
      select jsonb_agg(to_jsonb(pp) order by pp.realizadas desc, pp.nome nulls last)
        from por_profissional pp
    ), '[]'::jsonb),
    'pacotes', jsonb_build_object(
      'vendidos', coalesce((select sum(v.qtd) from vendidos v), 0),
      'vendidos_valor_cents', coalesce((select sum(v.valor) from vendidos v), 0),
      'vendidos_sem_valor', coalesce((select sum(v.sem_valor) from vendidos v), 0),
      'por_modalidade', coalesce((
        select jsonb_agg(jsonb_build_object('modalidade', v.modalidade, 'vendidos', v.qtd,
                                            'valor_cents', v.valor, 'sem_valor', v.sem_valor)
                                 order by v.valor desc, v.modalidade)
          from vendidos v
      ), '[]'::jsonb),
      'cancelados', (select c.qtd from cancelados c),
      'cancelados_valor_cents', (select c.valor from cancelados c),
      'reembolso_sugerido_cents', (select c.reembolso from cancelados c)
    ),
    'multas', jsonb_build_object(
      'geradas', coalesce((select sum(m.qtd) from multas m), 0),
      'geradas_valor_cents', coalesce((select sum(m.valor) from multas m), 0),
      'pendentes', coalesce((select m.qtd from multas m where m.status = 'pendente'), 0),
      'pendentes_valor_cents', coalesce((select m.valor from multas m where m.status = 'pendente'), 0),
      'pagas', coalesce((select m.qtd from multas m where m.status = 'paga'), 0),
      'pagas_valor_cents', coalesce((select m.valor from multas m where m.status = 'paga'), 0),
      'isentas', coalesce((select m.qtd from multas m where m.status = 'isenta'), 0),
      'isentas_valor_cents', coalesce((select m.valor from multas m where m.status = 'isenta'), 0)
    ),
    'pacientes_novos', (
      select count(*)
        from public.contacts c
       where c.organization_id = p_org
         and c.created_at >= p_de
         and c.created_at < p_ate
         and c.kind = 'person'
         and c.is_merged_into is null
    )
  )
  into v_resultado;

  return v_resultado;
end;
$f$;

revoke execute on function public.fn_clinica_relatorio_gestao(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_relatorio_gestao(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- a exportação: sessões ----
create or replace function public.fn_clinica_exportar_sessoes(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  id uuid,
  inicio timestamptz,
  status text,
  modalidade text,
  tipo text,
  profissional text,
  contato_name text,
  contato_display_name text,
  contato_phone text,
  do_pacote boolean,
  preco_tabela_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
#variable_conflict use_column
begin
  return query
  select a.id,
         a.starts_at,
         a.status,
         t.modalidade,
         et.name,
         pr.nome_profissional,
         c.name,
         c.display_name,
         c.phone_number,
         exists (
           select 1 from public.clinica_pacote_consumos pc
            where pc.organization_id = p_org and pc.appointment_id = a.id
         ),
         et.default_price_cents
    from public.calendar_appointments a
    join public.clinica_tipos_atendimento t
      on t.organization_id = p_org and t.event_type_id = a.event_type_id
    left join public.calendar_event_types et on et.id = a.event_type_id
    left join public.clinica_profissionais pr
      on pr.organization_id = p_org and pr.user_id = a.owner_user_id
    left join public.contacts c on c.id = a.contact_id and c.organization_id = p_org
   where a.organization_id = p_org
     and a.starts_at >= p_de
     and a.starts_at < p_ate
   order by a.starts_at, a.id;
end;
$f$;

revoke execute on function public.fn_clinica_exportar_sessoes(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_exportar_sessoes(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- a exportação: pacotes vendidos ou cancelados no período ----
create or replace function public.fn_clinica_exportar_pacotes(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  id uuid,
  comprado_em timestamptz,
  nome text,
  modalidade text,
  sessoes_total int,
  valor_cents bigint,
  currency text,
  status text,
  cancelado_em timestamptz,
  reembolso_sugerido_cents bigint,
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
  select p.id,
         p.comprado_em,
         p.nome,
         p.modalidade,
         p.sessoes_total,
         p.valor_cents,
         p.currency,
         p.status,
         p.cancelado_em,
         (select e.valor_cents from public.clinica_pacote_eventos e
           where e.pacote_id = p.id and e.tipo = 'cancelamento'
           order by e.registrado_em desc
           limit 1),
         c.name,
         c.display_name,
         c.phone_number
    from public.clinica_pacotes p
    left join public.contacts c on c.id = p.contact_id and c.organization_id = p_org
   where p.organization_id = p_org
     and (
       (p.comprado_em >= p_de and p.comprado_em < p_ate)
       or (p.cancelado_em >= p_de and p.cancelado_em < p_ate)
     )
   order by p.comprado_em, p.id;
end;
$f$;

revoke execute on function public.fn_clinica_exportar_pacotes(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_exportar_pacotes(uuid, timestamptz, timestamptz)
  to service_role;

-- ---- a exportação: multas geradas no período ----
create or replace function public.fn_clinica_exportar_multas(
  p_org uuid,
  p_de timestamptz,
  p_ate timestamptz
)
returns table (
  id uuid,
  gerada_em timestamptz,
  sessao_em timestamptz,
  percentual int,
  valor_cents int,
  currency text,
  status text,
  isencao_motivo text,
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
  select m.id,
         m.created_at,
         a.starts_at,
         m.percentual,
         m.valor_cents,
         m.currency,
         m.status,
         m.isencao_motivo,
         c.name,
         c.display_name,
         c.phone_number
    from public.clinica_multas m
    left join public.calendar_appointments a on a.id = m.appointment_id
    left join public.contacts c on c.id = m.contact_id and c.organization_id = p_org
   where m.organization_id = p_org
     and m.created_at >= p_de
     and m.created_at < p_ate
   order by m.created_at, m.id;
end;
$f$;

revoke execute on function public.fn_clinica_exportar_multas(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_clinica_exportar_multas(uuid, timestamptz, timestamptz)
  to service_role;
