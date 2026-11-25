-- Quem faz a habilitação continua vendo os processos (e clientes) em que já trocou a situação.
create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente and c.empresa_id = public.empresa_atual() and c.excluido_em is null
       and (public.is_backoffice() or public.is_juridico() or public.tem_permissao('clientes.ver_todos')
            or c.responsavel_admin_id = auth.uid()
            or (c.carteira = 'consultor' and (c.consultor_id = auth.uid() or public.is_supervisor_de(c.consultor_id)))
            or exists (select 1 from public.fichas_pendencia f
                        where f.cliente_id = c.id and f.empresa_id = c.empresa_id and f.status = 'encerrada'
                          and f.encaminhado_para = auth.uid())
            or (public.eh_habilitador() and (
                  exists (select 1 from public.cliente_casos k where k.cliente_id = c.id and k.status = 'habilitacao')
                  or exists (select 1 from public.cliente_casos_historico h join public.cliente_casos k on k.id = h.caso_id
                              where k.cliente_id = c.id and h.usuario_id = auth.uid()))))
  )
$$;

drop policy clientes_select_encaminhado on public.clientes;
create policy clientes_select_encaminhado on public.clientes for select to authenticated
  using (exists (select 1 from public.fichas_pendencia f
                  where f.cliente_id = clientes.id and f.status = 'encerrada' and f.encaminhado_para = (select auth.uid()))
         or ((select public.eh_habilitador()) and (
               exists (select 1 from public.cliente_casos k where k.cliente_id = clientes.id and k.status = 'habilitacao')
               or exists (select 1 from public.cliente_casos_historico h join public.cliente_casos k on k.id = h.caso_id
                           where k.cliente_id = clientes.id and h.usuario_id = (select auth.uid())))));
