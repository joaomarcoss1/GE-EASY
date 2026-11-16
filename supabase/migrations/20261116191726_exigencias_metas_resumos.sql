-- =====================================================================
-- Prazos de exigência (7 dias + uma prorrogação de 7), histórico de status dos processos (base das metas
-- de análise), metas geridas por quem tem a funcionalidade e rotinas diárias (alertas de exigência e
-- resumo diário dos assessores).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Prazo da exigência
-- ---------------------------------------------------------------------
alter table public.cliente_casos
  add column exigencia_aberta_em date,
  add column exigencia_prazo date,
  add column exigencia_prorrogada boolean not null default false;
create index cliente_casos_exigencia_prazo on public.cliente_casos (empresa_id, exigencia_prazo) where status = 'exigencia';

-- Ao entrar em exigência: prazo = hoje + 7 dias corridos. Única alteração aceita depois: prorrogar uma vez (+7).
-- Ao sair da exigência, o prazo é encerrado (o histórico guarda a passagem).
create or replace function public.cliente_caso_exigencia_prazo()
returns trigger language plpgsql set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.status = 'exigencia' then
    if tg_op = 'INSERT' or old.status is distinct from 'exigencia' then
      new.exigencia_aberta_em := v_hoje;
      new.exigencia_prazo := v_hoje + 7;
      new.exigencia_prorrogada := false;
    elsif new.exigencia_prorrogada and not old.exigencia_prorrogada then
      new.exigencia_prazo := old.exigencia_prazo + 7;
      new.exigencia_aberta_em := old.exigencia_aberta_em;
    else
      new.exigencia_prazo := old.exigencia_prazo;
      new.exigencia_prorrogada := old.exigencia_prorrogada;
      new.exigencia_aberta_em := old.exigencia_aberta_em;
    end if;
  else
    new.exigencia_aberta_em := null;
    new.exigencia_prazo := null;
    new.exigencia_prorrogada := false;
  end if;
  return new;
end $$;
create trigger trg_cliente_casos_yexigencia before insert or update on public.cliente_casos
  for each row execute function public.cliente_caso_exigencia_prazo();

-- ---------------------------------------------------------------------
-- 2. Histórico de status (quem mudou, de/para, quando)
-- ---------------------------------------------------------------------
create table public.cliente_casos_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  caso_id uuid not null references public.cliente_casos(id) on delete cascade,
  de text,
  para text not null,
  usuario_id uuid references public.profiles(id) on delete set null,
  em timestamptz not null default now()
);
create index on public.cliente_casos_historico (empresa_id, em);
create index on public.cliente_casos_historico (caso_id);
create index on public.cliente_casos_historico (usuario_id);
create trigger zz_empresa_vinculos before insert or update on public.cliente_casos_historico
  for each row execute function public.empresa_vinculos('caso_id:cliente_casos', 'usuario_id:@');

alter table public.cliente_casos_historico enable row level security;
create policy cliente_casos_historico_empresa on public.cliente_casos_historico as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy cliente_casos_historico_select on public.cliente_casos_historico for select to authenticated
  using ((select public.tem_permissao('clientes.view')));
-- sem políticas de escrita: só o gatilho grava

create or replace function public.cliente_caso_registrar_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.cliente_casos_historico (empresa_id, caso_id, de, para, usuario_id)
    values (new.empresa_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());
  end if;
  return null;
end $$;
revoke execute on function public.cliente_caso_registrar_status() from public, anon, authenticated;
create trigger trg_cliente_casos_historico after insert or update of status on public.cliente_casos
  for each row execute function public.cliente_caso_registrar_status();

-- ---------------------------------------------------------------------
-- 3. Metas: novo tipo "processos analisados" e gestão por funcionalidade (não só por papel)
-- ---------------------------------------------------------------------
alter type public.meta_tipo add value if not exists 'analises';

drop policy if exists metas_write_ins on public.metas;
drop policy if exists metas_write_upd on public.metas;
drop policy if exists metas_write_del on public.metas;
create policy metas_write_ins on public.metas for insert to authenticated with check ((select public.tem_permissao('metas.manage')));
create policy metas_write_upd on public.metas for update to authenticated
  using ((select public.tem_permissao('metas.manage'))) with check ((select public.tem_permissao('metas.manage')));
create policy metas_write_del on public.metas for delete to authenticated using ((select public.tem_permissao('metas.manage')));
drop policy if exists metas_select on public.metas;
create policy metas_select on public.metas for select to authenticated
  using ((select public.is_backoffice()) or (select public.tem_permissao('metas.manage'))
         or ((select public.is_active_user()) and (consultor_id = (select auth.uid()) or consultor_id is null)));

-- ---------------------------------------------------------------------
-- 4. Rotinas diárias
-- ---------------------------------------------------------------------
-- Exigências vencendo (até 2 dias) ou vencidas: avisa quem vê processos em exigência
create or replace function public.alertas_exigencias()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select c.empresa_id, m.user_id,
         case when c.exigencia_prazo < v_hoje then 'Exigência VENCIDA'
              when c.exigencia_prazo = v_hoje then 'Exigência vence HOJE'
              else 'Exigência vence em ' || (c.exigencia_prazo - v_hoje) || ' dia(s)' end,
         cl.nome || ' · ' || c.tipo || ' — prazo ' || to_char(c.exigencia_prazo, 'DD/MM/YYYY')
           || case when c.exigencia_prorrogada then ' (já prorrogada)' else ' (pode prorrogar 7 dias)' end,
         '/clientes/' || c.cliente_id,
         'exig:' || c.id || ':' || v_hoje
    from public.cliente_casos c
    join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
    join public.empresa_membros m on m.empresa_id = c.empresa_id and m.ativo
   where c.status = 'exigencia' and c.exigencia_prazo <= v_hoje + 2
     and exists (select 1 from public.permissoes_de(m.user_id, m.empresa_id) p where p = 'processos.status_restritos')
  on conflict (user_id, chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.alertas_exigencias() from public, anon, authenticated;

-- Resumo do dia: cada assessor com acesso ao sistema recebe o dele; a gestão do comercial recebe o consolidado
create or replace function public.resumo_diario_assessores(p_data date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n int := 0; k int; v_dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  with novos as (
    select cl.empresa_id, cl.assessor_id, count(*) qtd
      from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
     where (c.created_at at time zone 'America/Sao_Paulo')::date = v_dia and cl.assessor_id is not null
     group by 1, 2
  ), rota as (
    select r.empresa_id, r.consultor_id, count(distinct r.id) rotas,
           count(p.id) filter (where p.status = 'visitada') visitadas, count(p.id) paradas
      from public.rotas r left join public.rota_paradas p on p.rota_id = r.id
     where r.data = v_dia and r.status <> 'cancelada'
     group by 1, 2
  )
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select a.empresa_id, a.user_id, 'Resumo do dia ' || to_char(v_dia, 'DD/MM'),
         coalesce(nv.qtd, 0) || ' processo(s) novo(s)'
           || case when rt.rotas is null then ' · sem rota no dia'
                   else ' · rota: ' || rt.visitadas || ' de ' || rt.paradas || ' parada(s) visitada(s)' end,
         '/comercial/resumo-diario?data=' || v_dia,
         'resumo:' || a.id || ':' || v_dia
    from public.assessores a
    join public.empresa_membros m on m.empresa_id = a.empresa_id and m.user_id = a.user_id and m.ativo
    left join novos nv on nv.empresa_id = a.empresa_id and nv.assessor_id = a.id
    left join rota rt on rt.empresa_id = a.empresa_id and rt.consultor_id = a.user_id
   where a.ativo and a.user_id is not null
  on conflict (user_id, chave) where chave is not null do nothing;
  get diagnostics k = row_count; n := n + k;

  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select e.id, m.user_id, 'Resumo dos assessores ' || to_char(v_dia, 'DD/MM'),
         (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id
           where c.empresa_id = e.id and (c.created_at at time zone 'America/Sao_Paulo')::date = v_dia) || ' processo(s) novo(s) · '
         || (select count(*) from public.rotas r where r.empresa_id = e.id and r.data = v_dia and r.status in ('concluida', 'aprovada'))
         || ' de ' || (select count(*) from public.rotas r where r.empresa_id = e.id and r.data = v_dia and r.status <> 'cancelada') || ' rota(s) concluída(s)',
         '/comercial/resumo-diario?data=' || v_dia,
         'resumo-gestao:' || v_dia
    from public.empresas e
    join public.empresa_membros m on m.empresa_id = e.id and m.ativo
   where 'consultor' = any (e.modulos)
     and exists (select 1 from public.permissoes_de(m.user_id, e.id) p where p = 'consultores.manage')
  on conflict (user_id, chave) where chave is not null do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke execute on function public.resumo_diario_assessores(date) from public, anon, authenticated;

-- 08:00 e 20:30 (horário de Brasília)
select cron.schedule('geeasy-exigencias', '0 11 * * *', 'select public.alertas_exigencias()');
select cron.schedule('geeasy-resumo-assessores', '30 23 * * *', 'select public.resumo_diario_assessores()');
