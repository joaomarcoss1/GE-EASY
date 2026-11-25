-- O aviso de "novo processo para análise" leva para a lista de processos em análise.
-- Aviso do setor de destino quando uma pessoa muda a situação do processo
create or replace function public.cliente_caso_avisar_setor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_quem uuid := auth.uid();
  v_dest uuid[]; v_setor text; v_titulo text; v_link text; v_cliente text; u uuid;
begin
  if v_quem is null or new.status is not distinct from old.status
     or new.status not in ('pendencia', 'exigencia', 'em_analise', 'habilitacao') then
    return null;
  end if;
  if new.status = 'habilitacao' then
    v_dest := public.habilitadores(new.empresa_id);
  else
    v_setor := case new.status when 'pendencia' then 'Pendências' when 'exigencia' then 'Exigências' else 'Análise' end;
    v_dest := array(select dm.user_id from public.departamento_membros dm join public.departamentos d on d.id = dm.departamento_id
                     where d.empresa_id = new.empresa_id and d.nome = v_setor and dm.ativo);
  end if;
  v_titulo := case new.status when 'pendencia' then 'Novo processo em pendência' when 'exigencia' then 'Novo processo em exigência'
                when 'em_analise' then 'Novo processo para análise' else 'Novo processo para habilitação' end;
  v_link := case new.status when 'pendencia' then '/administrativo/pendencias' when 'exigencia' then '/administrativo/exigencias'
              when 'em_analise' then '/administrativo/processos?status=em_analise' else '/administrativo/encaminhados' end;
  select nome into v_cliente from public.clientes where id = new.cliente_id;
  foreach u in array coalesce(v_dest, '{}'::uuid[]) loop
    continue when u = v_quem;
    continue when not exists (select 1 from public.empresa_membros m where m.user_id = u and m.empresa_id = new.empresa_id and m.ativo);
    insert into public.notificacoes (user_id, empresa_id, titulo, mensagem, link, chave)
    values (u, new.empresa_id, v_titulo, coalesce(v_cliente, 'Cliente') || ' — ' || new.tipo, v_link,
            'caso_status:' || new.id || ':' || new.status || ':' || current_date)
    on conflict (user_id, chave) where chave is not null do nothing;
  end loop;
  return null;
end $$;
revoke execute on function public.cliente_caso_avisar_setor() from public, anon, authenticated;
