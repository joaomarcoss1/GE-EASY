-- Ficha de exigências (setor de Exigências, Vitória) no mesmo modelo da ficha de pendências, e o fluxo
-- "encaminhar para habilitação" (Aline). Pendências e Exigências podem mandar o processo para a análise (Tati)
-- ou para a habilitação (Aline); quem recebe vê o processo e o cliente que lhe foram encaminhados.

-- 1) nova situação do processo: aguardando a habilitação no INSS (não é status restrito)
alter table public.cliente_casos drop constraint cliente_casos_status_check;
alter table public.cliente_casos add constraint cliente_casos_status_check check (status = any (array[
  'arquivo_morto', 'habilitado', 'habilitacao', 'pendencia', 'exigencia', 'em_analise', 'deferido', 'indeferido',
  'aguardando_idade', 'judicializado', 'outros']));

-- 2) a ficha passa a ter tipo (pendência ou exigência) e novos destinos
alter table public.fichas_pendencia add column tipo text not null default 'pendencia' check (tipo in ('pendencia', 'exigencia'));
alter table public.fichas_pendencia add column exigencia_cumprida boolean;
alter table public.fichas_pendencia drop constraint fichas_pendencia_destino_check;
alter table public.fichas_pendencia add constraint fichas_pendencia_destino_check
  check (destino in ('habilitado', 'habilitacao', 'exigencia', 'pendencia', 'analise', 'outro'));
drop index public.fichas_pendencia_uma_aberta;
create unique index fichas_pendencia_uma_aberta on public.fichas_pendencia (caso_id, tipo) where status = 'aberta';
create index fichas_pendencia_tipo_idx on public.fichas_pendencia (empresa_id, tipo, status);
comment on table public.fichas_pendencia is 'Folhas de acompanhamento por processo: pendências (tipo pendencia) e exigências do INSS (tipo exigencia).';

create or replace function public.ficha_pendencia_integridade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select c.cliente_id into new.cliente_id from public.cliente_casos c where c.id = new.caso_id;
    select coalesce(max(f.numero), 0) + 1 into new.numero from public.fichas_pendencia f where f.caso_id = new.caso_id and f.tipo = new.tipo;
    new.status := 'aberta';
    new.responsavel_id := coalesce(new.responsavel_id, auth.uid());
    new.encerrada_em := null; new.encerrada_por := null;
    return new;
  end if;
  if old.status = 'encerrada' then
    raise exception 'Ficha encerrada não pode ser alterada.';
  end if;
  new.caso_id := old.caso_id; new.cliente_id := old.cliente_id; new.numero := old.numero; new.tipo := old.tipo;
  new.created_at := old.created_at; new.updated_at := now();
  if new.status = 'encerrada' then
    new.encerrada_em := now();
    new.encerrada_por := auth.uid();
    new.destino_em := coalesce(new.destino_em, current_date);
  end if;
  return new;
end $$;
revoke execute on function public.ficha_pendencia_integridade() from public, anon, authenticated;

-- 3) quem recebe o processo (analista, habilitação) lê a ficha que lhe foi encaminhada
drop policy fichas_pendencia_select on public.fichas_pendencia;
create policy fichas_pendencia_select on public.fichas_pendencia for select to authenticated
  using ((select public.tem_permissao('processos.status_restritos')) or encaminhado_para = (select auth.uid()));
drop policy ficha_itens_select on public.ficha_pendencia_itens;
create policy ficha_itens_select on public.ficha_pendencia_itens for select to authenticated
  using ((select public.tem_permissao('processos.status_restritos'))
         or exists (select 1 from public.fichas_pendencia f where f.id = ficha_id and f.encaminhado_para = (select auth.uid())));

-- ... e o cliente desse processo (para habilitar, ver documentos e contato), mesmo fora da sua carteira
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
                          and f.encaminhado_para = auth.uid()))
  )
$$;

-- 4) aviso para quem recebe, com o tipo da ficha
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
            '/administrativo/pendencias/' || f.id, 'ficha_pendencia:' || f.id || ':' || v_dest)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.notificar_ficha_encaminhada(uuid) from public, anon;
grant execute on function public.notificar_ficha_encaminhada(uuid) to authenticated;

-- 5) quem faz a habilitação (lista do encaminhamento), por empresa; na EASY, a Aline
insert into public.configuracoes (empresa_id, chave, valor)
select m.empresa_id, 'fluxo_processos', jsonb_build_object('habilitacao', jsonb_build_array(p.id))
  from public.profiles p join public.empresa_membros m on m.user_id = p.id
 where p.usuario = 'aline' and m.empresa_id = 'bdee63cf-d92f-4c1c-bc07-c48d30ffb7d6'
on conflict (empresa_id, chave) do nothing;
