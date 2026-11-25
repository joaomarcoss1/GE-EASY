-- Folha de Acompanhamento de Pendências (versão digital da ficha em papel).
-- Quem cuida das pendências (Vânia) abre uma ficha por processo, anota com data o que falta / o que foi pedido
-- (seção 1) e o retorno do cliente (seção 2) e, ao final, define o destino do processo (seção 3), assina e
-- encaminha — em geral para a analista (Tati). Anotações são um registro: só quem escreveu apaga, e só com a
-- ficha aberta. Ficha encerrada não muda mais (o gatilho bloqueia).

create table public.fichas_pendencia (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  caso_id uuid not null references public.cliente_casos(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete cascade,
  numero int not null default 1,
  beneficio text check (beneficio in ('aux_doenca', 'bpc', 'aposentadoria', 'sal_maternidade', 'pensao', 'outro')),
  segurado text check (segurado in ('rural', 'pescador', 'urbano')),
  recebida_em date not null default current_date,
  responsavel_id uuid default auth.uid() references public.profiles(id) on delete set null,
  status text not null default 'aberta' check (status in ('aberta', 'encerrada')),
  destino text check (destino in ('habilitado', 'exigencia', 'analise', 'outro')),
  destino_status text,
  destino_outro text check (char_length(destino_outro) <= 120),
  destino_em date,
  encaminhado_para uuid references public.profiles(id) on delete set null,
  assinatura_path text check (char_length(assinatura_path) <= 400),
  encerrada_em timestamptz,
  encerrada_por uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fichas_pendencia_encerrada check (
    status = 'aberta' or (destino is not null and destino_em is not null and assinatura_path is not null and encerrada_em is not null)
  )
);
comment on table public.fichas_pendencia is 'Folha de acompanhamento de pendências por processo (cliente_casos).';
create unique index fichas_pendencia_uma_aberta on public.fichas_pendencia (caso_id) where status = 'aberta';
create index on public.fichas_pendencia (empresa_id, status, created_at desc);
create index on public.fichas_pendencia (caso_id);
create index on public.fichas_pendencia (cliente_id);
create index on public.fichas_pendencia (responsavel_id);
create index on public.fichas_pendencia (encaminhado_para);
create index on public.fichas_pendencia (encerrada_por);

create table public.ficha_pendencia_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  ficha_id uuid not null references public.fichas_pendencia(id) on delete cascade,
  secao text not null check (secao in ('pendencia', 'retorno')),
  data date not null default current_date,
  texto text not null check (char_length(btrim(texto)) between 2 and 2000),
  prazo date,
  resolvida boolean not null default false,
  criado_por uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.ficha_pendencia_itens (ficha_id, secao, data, created_at);
create index on public.ficha_pendencia_itens (empresa_id);
create index on public.ficha_pendencia_itens (criado_por);

create trigger zz_empresa_vinculos before insert or update on public.fichas_pendencia
  for each row execute function public.empresa_vinculos('caso_id:cliente_casos', 'cliente_id:clientes', 'responsavel_id:@', 'encaminhado_para:@', 'encerrada_por:@');
create trigger zz_empresa_vinculos before insert or update on public.ficha_pendencia_itens
  for each row execute function public.empresa_vinculos('ficha_id:fichas_pendencia', 'criado_por:@');
create trigger trg_audit_fichas_pendencia after insert or update or delete on public.fichas_pendencia
  for each row execute function public.audit_trigger();
create trigger trg_audit_ficha_pendencia_itens after insert or update or delete on public.ficha_pendencia_itens
  for each row execute function public.audit_trigger();

-- Integridade: cliente e número vêm do processo; responsável não é trocado por qualquer um; encerrada não muda.
create or replace function public.ficha_pendencia_integridade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    select c.cliente_id into new.cliente_id from public.cliente_casos c where c.id = new.caso_id;
    select coalesce(max(f.numero), 0) + 1 into new.numero from public.fichas_pendencia f where f.caso_id = new.caso_id;
    new.status := 'aberta';
    new.responsavel_id := coalesce(new.responsavel_id, auth.uid());
    new.encerrada_em := null; new.encerrada_por := null;
    return new;
  end if;
  if old.status = 'encerrada' then
    raise exception 'Ficha encerrada não pode ser alterada.';
  end if;
  new.caso_id := old.caso_id; new.cliente_id := old.cliente_id; new.numero := old.numero;
  new.created_at := old.created_at; new.updated_at := now();
  if new.status = 'encerrada' then
    new.encerrada_em := now();
    new.encerrada_por := auth.uid();
    new.destino_em := coalesce(new.destino_em, current_date);
  end if;
  return new;
end $$;
revoke execute on function public.ficha_pendencia_integridade() from public, anon, authenticated;
create trigger trg_ficha_pendencia_integridade before insert or update on public.fichas_pendencia
  for each row execute function public.ficha_pendencia_integridade();

create or replace function public.ficha_item_integridade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.fichas_pendencia where id = coalesce(new.ficha_id, old.ficha_id);
  if v_status = 'encerrada' then
    raise exception 'Ficha encerrada: as anotações não podem mais ser alteradas.';
  end if;
  if tg_op = 'UPDATE' then
    -- só a marcação de "resolvida" muda depois de escrita (o texto é registro)
    new.ficha_id := old.ficha_id; new.secao := old.secao; new.data := old.data; new.texto := old.texto;
    new.prazo := old.prazo; new.criado_por := old.criado_por; new.created_at := old.created_at;
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.ficha_item_integridade() from public, anon, authenticated;
create trigger trg_ficha_item_integridade before insert or update or delete on public.ficha_pendencia_itens
  for each row execute function public.ficha_item_integridade();

-- RLS: quem trabalha com processos em pendência/exigência/análise (processos.status_restritos).
alter table public.fichas_pendencia enable row level security;
alter table public.ficha_pendencia_itens enable row level security;

create policy fichas_pendencia_empresa on public.fichas_pendencia as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy fichas_pendencia_select on public.fichas_pendencia for select to authenticated
  using ((select public.tem_permissao('processos.status_restritos')));
create policy fichas_pendencia_insert on public.fichas_pendencia for insert to authenticated
  with check ((select public.tem_permissao('processos.status_restritos')) and (select public.tem_permissao('clientes.write')));
create policy fichas_pendencia_update on public.fichas_pendencia for update to authenticated
  using ((select public.tem_permissao('processos.status_restritos')) and (select public.tem_permissao('clientes.write')))
  with check ((select public.tem_permissao('processos.status_restritos')) and (select public.tem_permissao('clientes.write')));

create policy ficha_itens_empresa on public.ficha_pendencia_itens as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy ficha_itens_select on public.ficha_pendencia_itens for select to authenticated
  using ((select public.tem_permissao('processos.status_restritos')));
create policy ficha_itens_insert on public.ficha_pendencia_itens for insert to authenticated
  with check (criado_por = (select auth.uid()) and (select public.tem_permissao('processos.status_restritos')) and (select public.tem_permissao('clientes.write')));
create policy ficha_itens_update on public.ficha_pendencia_itens for update to authenticated
  using ((select public.tem_permissao('processos.status_restritos')) and (select public.tem_permissao('clientes.write')))
  with check ((select public.tem_permissao('processos.status_restritos')) and (select public.tem_permissao('clientes.write')));
create policy ficha_itens_delete on public.ficha_pendencia_itens for delete to authenticated
  using (criado_por = (select auth.uid()));

-- Aviso para quem recebe o processo (a analista, ou o setor de destino). Só a própria ficha encerrada
-- pela pessoa que chama gera o aviso, e só para membros ativos da empresa.
create or replace function public.notificar_ficha_encaminhada(p_ficha uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  f record; v_cliente text; v_n int := 0; v_dest uuid;
  v_titulo text; v_setor text;
begin
  select * into f from public.fichas_pendencia
   where id = p_ficha and empresa_id = public.empresa_atual() and status = 'encerrada' and encerrada_por = auth.uid();
  if not found then return 0; end if;
  select nome into v_cliente from public.clientes where id = f.cliente_id;
  v_titulo := case f.destino
    when 'analise' then 'Processo enviado para análise'
    when 'exigencia' then 'Processo enviado para exigência'
    when 'habilitado' then 'Processo habilitado (pendências)'
    else 'Pendência encerrada' end;
  v_setor := case f.destino when 'analise' then 'Análise' when 'exigencia' then 'Exigências' else null end;
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
            coalesce(v_cliente, 'Cliente') || ' — ficha de pendências nº ' || f.numero || ' encerrada.',
            '/administrativo/pendencias/' || f.id, 'ficha_pendencia:' || f.id || ':' || v_dest)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.notificar_ficha_encaminhada(uuid) from public, anon;
grant execute on function public.notificar_ficha_encaminhada(uuid) to authenticated;
