-- Fila de habilitação e avisos por setor.
-- 1) Quem faz a habilitação (configuracoes.fluxo_processos.habilitacao) vê todos os processos "Para habilitação"
--    e o cliente deles, venham de ficha (Pendências/Exigências) ou da troca de situação feita pela análise (Tati).
-- 2) Quando um processo entra em pendência, exigência, análise ou habilitação por ação de uma pessoa, o setor de
--    destino é avisado. O aviso da ficha usa a mesma chave e só substitui o texto/link (sem aviso em dobro).

create or replace function public.habilitadores(p_empresa uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array(
    select x::uuid from public.configuracoes c, jsonb_array_elements_text(coalesce(c.valor->'habilitacao', '[]'::jsonb)) x
     where c.empresa_id = p_empresa and c.chave = 'fluxo_processos' and x ~ '^[0-9a-f-]{36}$'), '{}'::uuid[])
$$;
revoke execute on function public.habilitadores(uuid) from public, anon;
grant execute on function public.habilitadores(uuid) to authenticated;

create or replace function public.eh_habilitador()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = any (public.habilitadores(public.empresa_atual()))
$$;
revoke execute on function public.eh_habilitador() from public, anon;
grant execute on function public.eh_habilitador() to authenticated;

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
            or (public.eh_habilitador() and exists (select 1 from public.cliente_casos k
                                                     where k.cliente_id = c.id and k.status = 'habilitacao')))
  )
$$;

drop policy clientes_select_encaminhado on public.clientes;
create policy clientes_select_encaminhado on public.clientes for select to authenticated
  using (exists (select 1 from public.fichas_pendencia f
                  where f.cliente_id = clientes.id and f.status = 'encerrada' and f.encaminhado_para = (select auth.uid()))
         or ((select public.eh_habilitador())
             and exists (select 1 from public.cliente_casos k where k.cliente_id = clientes.id and k.status = 'habilitacao')));

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
              when 'em_analise' then '/administrativo/encaminhados' else '/administrativo/encaminhados' end;
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
create trigger trg_cliente_casos_avisar_setor after update of status on public.cliente_casos
  for each row execute function public.cliente_caso_avisar_setor();

-- Aviso da ficha: mesma chave do aviso automático; substitui texto e link pelo da ficha
create or replace function public.notificar_ficha_encaminhada(p_ficha uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  f record; v_cliente text; v_n int := 0; v_dest uuid;
  v_titulo text; v_setor text; v_ficha text;
begin
  select * into f from public.fichas_pendencia
   where id = p_ficha and empresa_id = public.empresa_atual() and status = 'encerrada' and encerrada_por = auth.uid();
  if not found then return 0; end if;
  select nome into v_cliente from public.clientes where id = f.cliente_id;
  v_ficha := case f.tipo when 'exigencia' then 'ficha de exigências' else 'ficha de pendências' end;
  v_titulo := case f.destino
    when 'analise' then 'Processo enviado para análise'
    when 'habilitacao' then 'Processo enviado para habilitação'
    when 'exigencia' then 'Processo enviado para exigência'
    when 'pendencia' then 'Processo devolvido para pendência'
    when 'habilitado' then 'Processo habilitado'
    else 'Ficha encerrada' end;
  v_setor := case f.destino when 'analise' then 'Análise' when 'exigencia' then 'Exigências' when 'pendencia' then 'Pendências' else null end;
  for v_dest in
    select distinct u from (
      select f.encaminhado_para u where f.encaminhado_para is not null
      union all
      select dm.user_id from public.departamento_membros dm join public.departamentos d on d.id = dm.departamento_id
       where v_setor is not null and f.encaminhado_para is null and d.empresa_id = f.empresa_id and d.nome = v_setor and dm.ativo
    ) x
    join public.empresa_membros m on m.user_id = x.u and m.empresa_id = f.empresa_id and m.ativo
    where x.u <> auth.uid()
  loop
    insert into public.notificacoes (user_id, empresa_id, titulo, mensagem, link, chave)
    values (v_dest, f.empresa_id, v_titulo,
            coalesce(v_cliente, 'Cliente') || ' — ' || v_ficha || ' nº ' || f.numero || ' encerrada.',
            '/administrativo/pendencias/' || f.id,
            'caso_status:' || f.caso_id || ':' || coalesce(f.destino_status, f.destino) || ':' || current_date)
    on conflict (user_id, chave) where chave is not null
      do update set titulo = excluded.titulo, mensagem = excluded.mensagem, link = excluded.link, lida = false;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.notificar_ficha_encaminhada(uuid) from public, anon;
grant execute on function public.notificar_ficha_encaminhada(uuid) to authenticated;
