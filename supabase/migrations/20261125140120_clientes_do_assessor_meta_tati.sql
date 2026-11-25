-- 1) O assessor vê os clientes ligados a ele (clientes.assessor_id → assessores.user_id) e a supervisora os da equipe.
--    A carteira (consultor/administrativo, prazo de documentação) não muda.
create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente and c.empresa_id = public.empresa_atual() and c.excluido_em is null
       and (public.is_backoffice() or public.is_juridico() or public.tem_permissao('clientes.ver_todos')
            or c.responsavel_admin_id = auth.uid()
            or (c.carteira = 'consultor' and (c.consultor_id = auth.uid() or public.is_supervisor_de(c.consultor_id)))
            or exists (select 1 from public.assessores a
                        where a.id = c.assessor_id and a.user_id is not null
                          and (a.user_id = auth.uid() or public.is_supervisor_de(a.user_id)))
            or exists (select 1 from public.fichas_pendencia f
                        where f.cliente_id = c.id and f.empresa_id = c.empresa_id and f.status = 'encerrada'
                          and f.encaminhado_para = auth.uid())
            or (public.eh_habilitador() and (
                  exists (select 1 from public.cliente_casos k where k.cliente_id = c.id and k.status = 'habilitacao')
                  or exists (select 1 from public.cliente_casos_historico h join public.cliente_casos k on k.id = h.caso_id
                              where k.cliente_id = c.id and h.usuario_id = auth.uid()))))
  )
$$;

create policy clientes_select_assessor on public.clientes for select to authenticated
  using (assessor_id is not null and exists (
    select 1 from public.assessores a
     where a.id = clientes.assessor_id and a.user_id is not null
       and (a.user_id = (select auth.uid()) or public.is_supervisor_de(a.user_id))));

-- 2) Liga cada cliente ao assessor dos seus processos (o do processo mais recente), para José e Aline.
with alvo as (
  select distinct on (k.cliente_id) k.cliente_id, k.assessor_id
    from public.cliente_casos k join public.assessores a on a.id = k.assessor_id
   where a.empresa_id = 'bdee63cf-d92f-4c1c-bc07-c48d30ffb7d6' and a.nome in ('José', 'Aline')
   order by k.cliente_id, k.recebido_em desc nulls last, k.created_at desc
)
update public.clientes c set assessor_id = alvo.assessor_id
  from alvo where c.id = alvo.cliente_id and c.assessor_id is null;

-- 3) Meta da Tati: 30 análises por mês
insert into public.metas_processos (empresa_id, nome, indicador, periodicidade, alvo, usuario_id, valor, ativo)
select m.empresa_id, 'Tati — processos analisados no mês', 'analises', 'mensal', 'usuario', p.id, 30, true
  from public.profiles p join public.empresa_membros m on m.user_id = p.id
 where p.usuario = 'tati' and m.empresa_id = 'bdee63cf-d92f-4c1c-bc07-c48d30ffb7d6'
   and not exists (select 1 from public.metas_processos x where x.usuario_id = p.id and x.indicador = 'analises' and x.ativo);
