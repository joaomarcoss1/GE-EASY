-- =====================================================================
-- Metas: só o administrador master e quem tiver "metas.ver_equipe" (a gerente administrativa) veem as metas e a
-- produção de todos. Os demais veem só a própria meta (de funcionário ou do seu cadastro de assessor).
-- =====================================================================
insert into public.funcionalidades (chave, nome, area, sensivel, ordem)
values ('metas.ver_equipe', 'Ver metas e produção de toda a equipe', 'administrativo', true, 37)
on conflict (chave) do update set nome = excluded.nome, area = excluded.area, sensivel = excluded.sensivel, ordem = excluded.ordem;

-- A gerente administrativa (Vanuza) recebe por exceção; o master já tem todas as funcionalidades.
insert into public.usuario_permissoes_extra (empresa_id, user_id, funcionalidade, tipo, motivo)
select m.empresa_id, m.user_id, 'metas.ver_equipe', 'concessao', 'Gerente administrativa: metas de toda a equipe'
  from public.empresa_membros m join public.profiles p on p.id = m.user_id
 where p.full_name = 'Vanuza Barbosa' and m.ativo
on conflict do nothing;

-- Metas do próprio usuário: as de funcionário (usuario_id) e as do seu cadastro de assessor (direto ou pela categoria).
create or replace function public.minhas_metas_assessor()
returns table (assessor_id uuid, categoria text) language sql stable security definer set search_path = '' as $$
  select a.id, a.categoria::text from public.assessores a
   where a.empresa_id = public.empresa_atual() and a.user_id = auth.uid() and a.ativo
$$;
revoke execute on function public.minhas_metas_assessor() from public, anon;
grant execute on function public.minhas_metas_assessor() to authenticated;

drop policy if exists metas_processos_select on public.metas_processos;
create policy metas_processos_select on public.metas_processos for select to authenticated
  using ((select public.tem_permissao('metas.ver_equipe'))
         or ((select public.tem_permissao('clientes.view')) and (
              usuario_id = (select auth.uid())
              or (alvo = 'assessor' and assessor_id in (select x.assessor_id from public.minhas_metas_assessor() x))
              or (alvo = 'categoria' and categoria::text in (select x.categoria from public.minhas_metas_assessor() x)))));

-- Metas comerciais antigas (consórcio/seguro): a equipe toda só com metas.ver_equipe; os demais, a sua.
drop policy if exists metas_select on public.metas;
create policy metas_select on public.metas for select to authenticated
  using ((select public.tem_permissao('metas.ver_equipe'))
         or ((select public.is_active_user()) and consultor_id = (select auth.uid())));

-- Painel de metas: sem metas.ver_equipe, só as linhas da própria pessoa.
create or replace function public.metas_processos_painel(p_ref date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_ref date := coalesce(p_ref, (now() at time zone 'America/Sao_Paulo')::date);
        v_todas boolean := public.tem_permissao('metas.ver_equipe'); v_uid uuid := auth.uid();
begin
  if v_emp is null or not public.is_active_user() or not (public.tem_permissao('clientes.view') or public.tem_permissao('metas.manage')) then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) - 'dono' order by x.ordem, x.periodo_ordem, x.assessor_nome nulls first, x.nome)
      from (
        select m.id meta_id, m.nome, m.indicador, m.periodicidade, m.alvo, m.categoria, m.valor,
               a.id assessor_id, coalesce(a.nome, pu.full_name) assessor_nome, m.usuario_id,
               (a.user_id is not null or m.usuario_id is not null) assessor_tem_usuario, per.ini inicio, per.fim,
               public.realizado_indicador(v_emp, m.indicador, a.id, per.ini, per.fim, m.usuario_id) realizado,
               case m.alvo when 'empresa' then 0 when 'usuario' then 1 when 'assessor' then 1 else 2 end ordem,
               case m.periodicidade when 'diaria' then 0 when 'mensal' then 1 else 2 end periodo_ordem,
               coalesce(a.user_id, m.usuario_id) dono
          from public.metas_processos m
          left join public.assessores a on a.empresa_id = v_emp and a.ativo
               and ((m.alvo = 'assessor' and a.id = m.assessor_id) or (m.alvo = 'categoria' and a.categoria = m.categoria))
          left join public.empresa_membros mu on mu.empresa_id = v_emp and mu.user_id = m.usuario_id and mu.ativo
          left join public.profiles pu on pu.id = mu.user_id
          cross join lateral (select case m.periodicidade when 'diaria' then v_ref when 'mensal' then date_trunc('month', v_ref)::date else date_trunc('year', v_ref)::date end ini,
                                     case m.periodicidade when 'diaria' then v_ref when 'mensal' then (date_trunc('month', v_ref) + interval '1 month - 1 day')::date
                                          else (date_trunc('year', v_ref) + interval '1 year - 1 day')::date end fim) per
         where m.empresa_id = v_emp and m.ativo and (m.alvo = 'empresa' or a.id is not null or pu.id is not null)
           and (v_todas or coalesce(a.user_id, m.usuario_id) = v_uid)
      ) x), '[]'::jsonb);
end $$;

-- Produtividade: com metas.ver_equipe, toda a equipe; sem, só a própria linha.
create or replace function public.produtividade_equipe(p_de date, p_ate date)
returns table (
  usuario_id uuid, nome text, papel text,
  trocas_status int, analises int, pendencias_resolvidas int, exigencias_cumpridas int,
  enviados_analise int, enviados_habilitacao int, habilitados int,
  fichas_abertas int, fichas_encerradas int, fichas_recebidas int, dossies int,
  resumos int, processos_trabalhados int, ultimo_acesso timestamptz, metas jsonb
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_emp uuid := public.empresa_atual();
  v_uid uuid := auth.uid();
  v_todas boolean := public.tem_permissao('metas.ver_equipe');
  v_ini timestamptz := (p_de::timestamp at time zone 'America/Sao_Paulo');
  v_fim timestamptz := ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  if v_emp is null or v_uid is null or not public.is_active_user() then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  with h as (
    select h.usuario_id, h.de, h.para from public.cliente_casos_historico h
     where h.empresa_id = v_emp and h.em >= v_ini and h.em < v_fim and h.usuario_id is not null
       and (v_todas or h.usuario_id = v_uid)
  ),
  pessoas as (
    select m.user_id, p.full_name, m.role::text as papel
      from public.empresa_membros m join public.profiles p on p.id = m.user_id
     where m.empresa_id = v_emp and m.ativo and p.active
       and (case when v_todas
                 then m.role::text <> 'consultor_externo'
                      and (m.role::text <> 'consultor' or m.user_id = any(public.habilitadores(v_emp)) or exists (select 1 from h where h.usuario_id = m.user_id))
                 else m.user_id = v_uid end)
  ),
  f as (select * from public.fichas_pendencia x where x.empresa_id = v_emp)
  select pe.user_id, pe.full_name, pe.papel,
    (select count(*) from h where h.usuario_id = pe.user_id)::int,
    (select count(*) from h where h.usuario_id = pe.user_id and h.de = 'em_analise' and h.para <> 'em_analise')::int,
    (select count(*) from h where h.usuario_id = pe.user_id and h.de = 'pendencia' and h.para not in ('pendencia', 'arquivo_morto', 'indeferido'))::int,
    (select count(*) from h where h.usuario_id = pe.user_id and h.de = 'exigencia' and h.para not in ('exigencia', 'arquivo_morto', 'indeferido'))::int,
    (select count(*) from h where h.usuario_id = pe.user_id and h.para = 'em_analise' and h.de is not null)::int,
    (select count(*) from h where h.usuario_id = pe.user_id and h.para = 'habilitacao')::int,
    (select count(*) from h where h.usuario_id = pe.user_id and h.para = 'habilitado')::int,
    (select count(*) from f where f.responsavel_id = pe.user_id and f.created_at >= v_ini and f.created_at < v_fim)::int,
    (select count(*) from f where f.encerrada_por = pe.user_id and f.encerrada_em >= v_ini and f.encerrada_em < v_fim)::int,
    (select count(*) from f where f.encaminhado_para = pe.user_id and f.encerrada_em >= v_ini and f.encerrada_em < v_fim)::int,
    (select count(*) from public.dossies d where d.empresa_id = v_emp and d.gerado_por = pe.user_id and d.created_at >= v_ini and d.created_at < v_fim)::int,
    (select count(*) from public.resumos_diarios r where r.empresa_id = v_emp and r.usuario_id = pe.user_id and r.data between p_de and p_ate)::int,
    (select coalesce(sum(r.processos_trabalhados), 0) from public.resumos_diarios r where r.empresa_id = v_emp and r.usuario_id = pe.user_id and r.data between p_de and p_ate)::int,
    (select max(a.created_at) from public.audit_logs a where a.actor_id = pe.user_id and a.acao = 'LOGIN'),
    coalesce((select jsonb_object_agg(mp.indicador, mp.valor) from public.metas_processos mp
               where mp.empresa_id = v_emp and mp.ativo and mp.alvo = 'usuario' and mp.usuario_id = pe.user_id and mp.periodicidade = 'mensal'), '{}'::jsonb)
  from pessoas pe
  order by pe.full_name;
end $$;
revoke execute on function public.produtividade_equipe(date, date) from public, anon;
grant execute on function public.produtividade_equipe(date, date) to authenticated;
