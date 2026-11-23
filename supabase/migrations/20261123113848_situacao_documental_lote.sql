-- Evita uma chamada HTTP/RPC por cliente no snapshot do aplicativo de campo.
create or replace function public.situacao_documental_lote(p_clientes uuid[])
returns table (cliente_id uuid, faltando text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,
         coalesce(array(select jsonb_array_elements_text(public.situacao_documental(c.id)->'faltando')), '{}'::text[])
    from public.clientes c
   where c.id = any(coalesce(p_clientes, '{}'::uuid[]))
     and public.can_access_cliente(c.id)
$$;

revoke all on function public.situacao_documental_lote(uuid[]) from public;
grant execute on function public.situacao_documental_lote(uuid[]) to authenticated;

comment on function public.situacao_documental_lote(uuid[]) is
  'Situação documental em lote para o cache offline; respeita o acesso a cada cliente.';
