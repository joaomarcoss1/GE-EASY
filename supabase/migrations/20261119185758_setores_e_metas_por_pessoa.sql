-- =====================================================================
-- Metas por pessoa (funcionário que não é assessor) e indicadores de pendências resolvidas e exigências
-- cumpridas; setores Pendências, Exigências e Análise no Administrativo; equipe da EASY reorganizada:
-- Vânia (pendências), Vitória (exigências), Tati (analista), Vanuza (gerente), Aline (supervisora do comercial).
-- =====================================================================

-- 1. Metas: alvo "usuario" e novos indicadores
alter table public.metas_processos add column usuario_id uuid references public.profiles(id) on delete cascade;
create index on public.metas_processos (usuario_id);
alter table public.metas_processos drop constraint metas_processos_alvo_check;
alter table public.metas_processos add constraint metas_processos_alvo_check check (alvo in ('empresa', 'assessor', 'categoria', 'usuario'));
alter table public.metas_processos drop constraint metas_processos_indicador_check;
alter table public.metas_processos add constraint metas_processos_indicador_check check (indicador in
  ('processos_novos', 'habilitados', 'judicializados', 'analises', 'ligacoes', 'pendencias_resolvidas', 'exigencias_cumpridas'));
alter table public.metas_processos add constraint metas_processos_usuario_check check ((alvo = 'usuario') = (usuario_id is not null));
drop trigger zz_empresa_vinculos on public.metas_processos;
create trigger zz_empresa_vinculos before insert or update on public.metas_processos
  for each row execute function public.empresa_vinculos('assessor_id:assessores', 'usuario_id:@');

-- 2. Realizado: por assessor (o que ele trouxe) ou por pessoa (o que ela fez)
drop function if exists public.realizado_indicador(uuid, text, uuid, date, date);
create or replace function public.realizado_indicador(p_emp uuid, p_indicador text, p_assessor uuid, p_ini date, p_fim date, p_usuario uuid default null)
returns integer language sql stable security definer set search_path = '' as $$
  with u as (select coalesce(p_usuario, (select a.user_id from public.assessores a where a.id = p_assessor)) uid),
  h as (
    select h.*, c.assessor_id from public.cliente_casos_historico h join public.cliente_casos c on c.id = h.caso_id
     where h.empresa_id = p_emp and (h.em at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
       and (p_usuario is null or h.usuario_id = p_usuario)
       and (p_assessor is null or p_usuario is not null or c.assessor_id = p_assessor)
  )
  select (case p_indicador
    when 'processos_novos' then (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
        where c.empresa_id = p_emp and c.recebido_em between p_ini and p_fim
          and (p_assessor is null or c.assessor_id = p_assessor) and (p_usuario is null or cl.consultor_id = p_usuario))
    when 'habilitados' then
      case when p_usuario is null then (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
        where c.empresa_id = p_emp and c.habilitado_em between p_ini and p_fim and (p_assessor is null or c.assessor_id = p_assessor))
      else (select count(distinct caso_id) from h where para = 'habilitado') end
    when 'judicializados' then (select count(distinct caso_id) from h where para = 'judicializado')
    when 'analises' then (select count(*) from h where de = 'em_analise' and para <> 'em_analise')
    when 'pendencias_resolvidas' then (select count(*) from h where de = 'pendencia' and para not in ('pendencia', 'arquivo_morto', 'indeferido'))
    when 'exigencias_cumpridas' then (select count(*) from h where de = 'exigencia' and para not in ('exigencia', 'arquivo_morto', 'indeferido'))
    when 'ligacoes' then (
      select coalesce(sum(greatest(
        coalesce((select sum(r.ligacoes) from public.resumos_diarios r
                   where r.empresa_id = p_emp and r.data = d.dia
                     and ((p_assessor is null and p_usuario is null) or r.usuario_id = (select uid from u) or (p_usuario is null and r.assessor_id = p_assessor))), 0),
        coalesce((select count(*) from public.interacoes i
                   where i.empresa_id = p_emp and i.tipo = 'ligacao' and (i.created_at at time zone 'America/Sao_Paulo')::date = d.dia
                     and ((p_assessor is null and p_usuario is null) or i.autor_id = (select uid from u))), 0))), 0)
        from (select g::date dia from generate_series(p_ini, p_fim, interval '1 day') g) d)
  end)::int
$$;
revoke execute on function public.realizado_indicador(uuid, text, uuid, date, date, uuid) from public, anon, authenticated;

create or replace function public.metas_processos_painel(p_ref date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_ref date := coalesce(p_ref, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if v_emp is null or not public.is_active_user() or not (public.tem_permissao('clientes.view') or public.tem_permissao('metas.manage')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.ordem, x.periodo_ordem, x.assessor_nome nulls first, x.nome)
      from (
        select m.id meta_id, m.nome, m.indicador, m.periodicidade, m.alvo, m.categoria, m.valor,
               a.id assessor_id, coalesce(a.nome, pu.full_name) assessor_nome, m.usuario_id,
               (a.user_id is not null or m.usuario_id is not null) assessor_tem_usuario, per.ini inicio, per.fim,
               public.realizado_indicador(v_emp, m.indicador, a.id, per.ini, per.fim, m.usuario_id) realizado,
               case m.alvo when 'empresa' then 0 when 'usuario' then 1 when 'assessor' then 1 else 2 end ordem,
               case m.periodicidade when 'diaria' then 0 when 'mensal' then 1 else 2 end periodo_ordem
          from public.metas_processos m
          left join public.assessores a on a.empresa_id = v_emp and a.ativo
               and ((m.alvo = 'assessor' and a.id = m.assessor_id) or (m.alvo = 'categoria' and a.categoria = m.categoria))
          left join public.empresa_membros mu on mu.empresa_id = v_emp and mu.user_id = m.usuario_id and mu.ativo
          left join public.profiles pu on pu.id = mu.user_id
          cross join lateral (select case m.periodicidade when 'diaria' then v_ref when 'mensal' then date_trunc('month', v_ref)::date else date_trunc('year', v_ref)::date end ini,
                                     case m.periodicidade when 'diaria' then v_ref when 'mensal' then (date_trunc('month', v_ref) + interval '1 month - 1 day')::date
                                          else (date_trunc('year', v_ref) + interval '1 year - 1 day')::date end fim) per
         where m.empresa_id = v_emp and m.ativo and (m.alvo = 'empresa' or a.id is not null or pu.id is not null)
      ) x), '[]'::jsonb);
end $$;
revoke execute on function public.metas_processos_painel(date) from public, anon;
grant execute on function public.metas_processos_painel(date) to authenticated;

-- 3. Equipe da EASY
do $$
declare
  v_emp uuid; v_dep uuid; v_nivel uuid; v_sup uuid; v_ger uuid; r record;
  v_vania uuid; v_vitoria uuid; v_tati uuid; v_vanuza uuid; v_aline uuid; v_com uuid;
begin
  select id into v_emp from public.empresas where nome ilike 'EASY%' order by created_at limit 1;
  if v_emp is null then return; end if;
  select id into v_vania from public.profiles where usuario = 'vania';
  select id into v_vitoria from public.profiles where usuario = 'vitoria';
  select id into v_tati from public.profiles where usuario = 'tati';
  select id into v_aline from public.profiles where usuario = 'aline';
  select p.id into v_vanuza from public.profiles p join public.empresa_membros m on m.user_id = p.id and m.empresa_id = v_emp where p.full_name ilike 'Vanuza Barbosa%';
  select id into v_com from public.departamentos where empresa_id = v_emp and tipo = 'consultor' order by created_at limit 1;

  -- setores do Administrativo (níveis padrão: Operador, Supervisor, Gestor)
  for r in select * from (values ('Pendências', 'PEN', 'Cobrança e resolução das pendências dos processos', v_vania),
                                 ('Exigências', 'EXI', 'Cumprimento das exigências do INSS no prazo', v_vitoria),
                                 ('Análise', 'ANA', 'Análise dos processos recebidos', v_tati)) s(nome, sigla, descricao, pessoa) loop
    select id into v_dep from public.departamentos where empresa_id = v_emp and nome = r.nome;
    if v_dep is null then
      insert into public.departamentos (empresa_id, nome, sigla, descricao, tipo, responsavel_id, ativo)
      values (v_emp, r.nome, r.sigla, r.descricao, 'administrativo', v_vanuza, true) returning id into v_dep;
      perform public.criar_niveis_padrao(v_dep);
    end if;
    select id into v_nivel from public.departamento_niveis where departamento_id = v_dep and nome = 'Operador';
    select id into v_ger from public.departamento_niveis where departamento_id = v_dep and nome = 'Gestor';
    if r.pessoa is not null then
      insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id, ativo)
      values (v_emp, v_dep, r.pessoa, 'membro', v_nivel, true)
      on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id, ativo = true, funcao = 'membro';
    end if;
    if v_vanuza is not null then
      insert into public.departamento_membros (empresa_id, departamento_id, user_id, funcao, nivel_id, ativo)
      values (v_emp, v_dep, v_vanuza, 'responsavel', v_ger, true)
      on conflict (departamento_id, user_id) do update set nivel_id = excluded.nivel_id, ativo = true, funcao = 'responsavel';
    end if;
  end loop;

  -- Vânia, Vitória e Tati: perfil administrativo, fora do comercial, veem processos em pendência/exigência/análise
  for r in select unnest(array[v_vania, v_vitoria, v_tati]) uid loop
    continue when r.uid is null;
    update public.empresa_membros set role = 'administrativo' where empresa_id = v_emp and user_id = r.uid;
    delete from public.departamento_membros where empresa_id = v_emp and user_id = r.uid and departamento_id = v_com;
    delete from public.equipe_membros where empresa_id = v_emp and membro_id = r.uid;
    -- o acesso padrão do perfil anterior (Administrativo › Operador) não é necessário: ficam só no seu setor
    delete from public.departamento_membros dm using public.departamentos d
     where dm.departamento_id = d.id and d.empresa_id = v_emp and dm.user_id = r.uid and d.nome = 'Administrativo';
    insert into public.usuario_permissoes_extra (empresa_id, user_id, funcionalidade, tipo, motivo)
    values (v_emp, r.uid, 'processos.status_restritos', 'concessao', 'Trabalha com processos em pendência, exigência e análise')
    on conflict (empresa_id, user_id, funcionalidade) do update set tipo = 'concessao', motivo = excluded.motivo, valido_ate = null;
  end loop;
  update public.profiles set cargo = 'Setor de pendências' where id = v_vania;
  update public.profiles set cargo = 'Setor de exigências' where id = v_vitoria;
  update public.profiles set cargo = 'Analista' where id = v_tati;
  update public.profiles set cargo = 'Gerente administrativa' where id = v_vanuza;
  update public.profiles set cargo = 'Supervisora comercial' where id = v_aline;

  -- Vânia e Vitória não são assessoras: o cadastro de assessor sai da lista (os processos antigos continuam ligados)
  update public.assessores set ativo = false, observacoes = 'Não é assessora: trabalha no setor de ' || case when user_id = v_vania then 'pendências' else 'exigências' end
   where empresa_id = v_emp and user_id in (v_vania, v_vitoria);

  -- metas delas passam a ser da pessoa, medidas pelo trabalho do setor
  delete from public.metas_processos m using public.assessores a
   where m.assessor_id = a.id and a.empresa_id = v_emp and a.user_id in (v_vania, v_vitoria);
  if v_vania is not null then
    insert into public.metas_processos (empresa_id, nome, indicador, periodicidade, alvo, usuario_id, valor) values
      (v_emp, 'Vânia — pendências resolvidas no mês', 'pendencias_resolvidas', 'mensal', 'usuario', v_vania, 20),
      (v_emp, 'Vânia — ligações para clientes por dia', 'ligacoes', 'diaria', 'usuario', v_vania, 20);
  end if;
  if v_vitoria is not null then
    insert into public.metas_processos (empresa_id, nome, indicador, periodicidade, alvo, usuario_id, valor) values
      (v_emp, 'Vitória — exigências cumpridas no mês', 'exigencias_cumpridas', 'mensal', 'usuario', v_vitoria, 10),
      (v_emp, 'Vitória — ligações para clientes por dia', 'ligacoes', 'diaria', 'usuario', v_vitoria, 20);
  end if;
end $$;
