-- =====================================================================
-- Produtividade da equipe interna (Pendências, Exigências, Análise, Habilitação…): o que cada pessoa fez no período,
-- pelo histórico de status (quem mudou), fichas, dossiês e resumos do dia. Os assessores ficam no relatório por assessor.
-- Só para quem vê toda a base (clientes.ver_todos); sempre na empresa ativa.
-- =====================================================================
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
  v_ini timestamptz := (p_de::timestamp at time zone 'America/Sao_Paulo');
  v_fim timestamptz := ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
begin
  if v_emp is null or not public.tem_permissao('clientes.ver_todos') then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  return query
  with h as (
    select h.usuario_id, h.de, h.para from public.cliente_casos_historico h
     where h.empresa_id = v_emp and h.em >= v_ini and h.em < v_fim and h.usuario_id is not null
  ),
  -- equipe interna; do comercial só quem também habilita ou mexeu em processos no período
  pessoas as (
    select m.user_id, p.full_name, m.role::text as papel
      from public.empresa_membros m join public.profiles p on p.id = m.user_id
     where m.empresa_id = v_emp and m.ativo and p.active and m.role::text <> 'consultor_externo'
       and (m.role::text <> 'consultor' or m.user_id = any(public.habilitadores(v_emp)) or exists (select 1 from h where h.usuario_id = m.user_id))
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
