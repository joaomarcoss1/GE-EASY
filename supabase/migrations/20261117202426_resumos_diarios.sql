-- =====================================================================
-- Resumo do dia do consultor/assessor: processos, ligações (para quem e resultado), visitas, documentos,
-- pendências e observações. Preenchido em até 2 minutos (números do sistema já vêm sugeridos).
-- As ligações do resumo passam a contar na meta de ligações (sem contar em dobro o que já está no histórico).
-- =====================================================================
create table public.resumos_diarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  usuario_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  assessor_id uuid references public.assessores(id) on delete set null,
  data date not null,
  processos_novos integer not null default 0 check (processos_novos between 0 and 500),
  processos_trabalhados integer not null default 0 check (processos_trabalhados between 0 and 1000),
  ligacoes integer not null default 0 check (ligacoes between 0 and 1000),
  visitas integer not null default 0 check (visitas between 0 and 200),
  documentos_coletados integer not null default 0 check (documentos_coletados between 0 and 500),
  pendencias_resolvidas integer not null default 0 check (pendencias_resolvidas between 0 and 500),
  ligacoes_detalhe jsonb not null default '[]' check (jsonb_typeof(ligacoes_detalhe) = 'array' and jsonb_array_length(ligacoes_detalhe) <= 200),
  avaliacao text check (avaliacao in ('otimo', 'bom', 'regular', 'dificil')),
  atividades text check (char_length(atividades) <= 1000),
  dificuldades text check (char_length(dificuldades) <= 1000),
  plano_amanha text check (char_length(plano_amanha) <= 1000),
  enviado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, usuario_id, data)
);
create index on public.resumos_diarios (empresa_id, data);
create index on public.resumos_diarios (usuario_id);
create index on public.resumos_diarios (assessor_id);

create or replace function public.resumo_diario_preparar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is not null and (new.data > v_hoje or new.data < v_hoje - 1) then
    raise exception 'O resumo é feito no dia (ou no dia seguinte, para corrigir).' using errcode = '23514';
  end if;
  select a.id into new.assessor_id from public.assessores a
   where a.empresa_id = new.empresa_id and a.user_id = new.usuario_id and a.ativo order by a.created_at limit 1;
  new.atualizado_em := now();
  return new;
end $$;
revoke execute on function public.resumo_diario_preparar() from public, anon, authenticated;
create trigger trg_resumos_diarios_preparar before insert or update on public.resumos_diarios
  for each row execute function public.resumo_diario_preparar();
create trigger zz_empresa_vinculos before insert or update on public.resumos_diarios
  for each row execute function public.empresa_vinculos('usuario_id:@', 'assessor_id:assessores');
create trigger trg_audit_resumos_diarios after insert or update or delete on public.resumos_diarios
  for each row execute function public.audit_trigger();

alter table public.resumos_diarios enable row level security;
create policy resumos_diarios_empresa on public.resumos_diarios as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
create policy resumos_diarios_select on public.resumos_diarios for select to authenticated
  using (usuario_id = (select auth.uid()) or (select public.tem_permissao('consultores.manage')) or (select public.tem_permissao('clientes.ver_todos')));
create policy resumos_diarios_insert on public.resumos_diarios for insert to authenticated
  with check (usuario_id = (select auth.uid()));
create policy resumos_diarios_update on public.resumos_diarios for update to authenticated
  using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));

-- Meta de ligações: por dia, o maior entre o que foi declarado no resumo e o registrado no histórico dos clientes
create or replace function public.realizado_indicador(p_emp uuid, p_indicador text, p_assessor uuid, p_ini date, p_fim date)
returns integer language sql stable security definer set search_path = '' as $$
  select (case p_indicador
    when 'processos_novos' then (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
        where c.empresa_id = p_emp and c.recebido_em between p_ini and p_fim and (p_assessor is null or c.assessor_id = p_assessor))
    when 'habilitados' then (select count(*) from public.cliente_casos c join public.clientes cl on cl.id = c.cliente_id and cl.excluido_em is null
        where c.empresa_id = p_emp and c.habilitado_em between p_ini and p_fim and (p_assessor is null or c.assessor_id = p_assessor))
    when 'judicializados' then (select count(distinct h.caso_id) from public.cliente_casos_historico h join public.cliente_casos c on c.id = h.caso_id
        where h.empresa_id = p_emp and h.para = 'judicializado' and (h.em at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
          and (p_assessor is null or c.assessor_id = p_assessor))
    when 'analises' then (select count(*) from public.cliente_casos_historico h join public.cliente_casos c on c.id = h.caso_id
        where h.empresa_id = p_emp and h.de = 'em_analise' and h.para <> 'em_analise' and (h.em at time zone 'America/Sao_Paulo')::date between p_ini and p_fim
          and (p_assessor is null or c.assessor_id = p_assessor))
    when 'ligacoes' then (
      with u as (select a.user_id from public.assessores a where a.id = p_assessor)
      select coalesce(sum(greatest(
        coalesce((select sum(r.ligacoes) from public.resumos_diarios r
                   where r.empresa_id = p_emp and r.data = d.dia and (p_assessor is null or r.assessor_id = p_assessor or r.usuario_id = (select user_id from u))), 0),
        coalesce((select count(*) from public.interacoes i
                   where i.empresa_id = p_emp and i.tipo = 'ligacao' and (i.created_at at time zone 'America/Sao_Paulo')::date = d.dia
                     and (p_assessor is null or i.autor_id = (select user_id from u))), 0))), 0)
        from (select g::date dia from generate_series(p_ini, p_fim, interval '1 day') g) d)
  end)::int
$$;
revoke execute on function public.realizado_indicador(uuid, text, uuid, date, date) from public, anon, authenticated;

-- Lembrete às 18h para quem ainda não enviou o resumo (assessores com usuário e consultores)
create or replace function public.lembrar_resumo_diario()
returns integer language plpgsql security definer set search_path = '' as $$
declare n int; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if extract(isodow from v_hoje) = 7 then return 0; end if; -- domingo
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select distinct m.empresa_id, m.user_id, 'Faça o resumo do dia', 'Leva menos de 2 minutos: processos, ligações e para quem ligou.', '/comercial/meu-resumo', 'lembrete-resumo:' || v_hoje
    from public.empresa_membros m
    join public.profiles p on p.id = m.user_id and p.active
   where m.ativo
     and (m.role in ('consultor', 'consultor_externo') or exists (select 1 from public.assessores a where a.empresa_id = m.empresa_id and a.user_id = m.user_id and a.ativo))
     and not exists (select 1 from public.resumos_diarios r where r.empresa_id = m.empresa_id and r.usuario_id = m.user_id and r.data = v_hoje)
  on conflict (user_id, chave) where chave is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.lembrar_resumo_diario() from public, anon, authenticated;
select cron.schedule('geeasy-lembrete-resumo', '0 21 * * *', 'select public.lembrar_resumo_diario()');
