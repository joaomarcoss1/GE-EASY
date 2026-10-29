/**
 * Distribuição: (1) cliente com dono na carteira → o dono (consultor ativo) ou a base administrativa;
 * (2) primeira regra que combina (cidade, DDD, origem, interesse, campanha ou qualquer), escolhendo o membro
 * por rodízio ou menor carga; (3) sem regra: ninguém (fila geral). Retorna usuário e departamento.
 */
create or replace function public.distribuir(p_empresa uuid, p_tipo text, p_cliente uuid, p_cidade text, p_telefone text,
  p_origem text, p_interesse text, p_campanha text, p_excluir uuid default null)
returns table (usuario_id uuid, departamento_id uuid) language plpgsql security definer set search_path = '' as $$
declare c record; r public.distribuicao_regras; v_ativos uuid[]; v_escolhido uuid; v_idx int; v_dep_adm uuid;
begin
  if p_cliente is not null then
    select cl.carteira, cl.consultor_id, cl.responsavel_admin_id into c from public.clientes cl where cl.id = p_cliente and cl.empresa_id = p_empresa;
    if found then
      if c.carteira = 'consultor' and c.consultor_id is not null and c.consultor_id is distinct from p_excluir
         and exists (select 1 from public.empresa_membros m where m.empresa_id = p_empresa and m.user_id = c.consultor_id and m.ativo) then
        return query select c.consultor_id, null::uuid; return;
      end if;
      if c.carteira = 'administrativo' then
        select d.id into v_dep_adm from public.departamentos d where d.empresa_id = p_empresa and d.tipo = 'administrativo' and d.ativo order by d.created_at limit 1;
        return query select c.responsavel_admin_id, v_dep_adm; return;
      end if;
    end if;
  end if;
  for r in select * from public.distribuicao_regras x where x.empresa_id = p_empresa and x.ativo
             and ((p_tipo = 'lead' and x.aplica_leads) or (p_tipo = 'whatsapp' and x.aplica_whatsapp)) order by x.ordem for update loop
    continue when not (
         r.criterio = 'qualquer'
      or (r.criterio = 'cidade' and lower(coalesce(p_cidade, '')) = lower(coalesce(r.valor, '-')))
      or (r.criterio = 'ddd' and substr(coalesce(p_telefone, ''), 3, 2) = coalesce(r.valor, '-'))
      or (r.criterio = 'origem' and coalesce(p_origem, '') = coalesce(r.valor, '-'))
      or (r.criterio = 'interesse' and coalesce(p_interesse, '') ilike '%' || coalesce(r.valor, '-') || '%')
      or (r.criterio = 'campanha' and coalesce(p_campanha, '') ilike '%' || coalesce(r.valor, '-') || '%'));
    select array_agg(m order by ord) into v_ativos
      from unnest(r.membros) with ordinality as u(m, ord)
     where m is distinct from p_excluir and exists (select 1 from public.empresa_membros em where em.empresa_id = p_empresa and em.user_id = m and em.ativo);
    if coalesce(array_length(v_ativos, 1), 0) = 0 then
      if r.departamento_id is not null then return query select null::uuid, r.departamento_id; return; end if;
      continue;
    end if;
    if r.modo = 'menor_carga' then
      select m into v_escolhido from unnest(v_ativos) m
       order by (select count(*) from public.leads l where l.empresa_id = p_empresa and l.responsavel_id = m and l.status in ('novo', 'em_contato'))
              + (select count(*) from public.wa_conversas w where w.empresa_id = p_empresa and w.atendente_id = m and w.status in ('aberta', 'aguardando_atendente', 'aguardando_cliente')),
                m
       limit 1;
    else
      v_idx := (r.ultimo_indice + 1) % array_length(v_ativos, 1);
      v_escolhido := v_ativos[v_idx + 1];
      update public.distribuicao_regras set ultimo_indice = v_idx where id = r.id;
    end if;
    return query select v_escolhido, r.departamento_id; return;
  end loop;
  return query select null::uuid, null::uuid;
end $$;
revoke execute on function public.distribuir(uuid, text, uuid, text, text, text, text, text, uuid) from public, anon, authenticated;

-- Antes de gravar: normaliza, pontua, distribui (lead novo sem responsável) e abre o SLA de primeiro contato
create or replace function public.lead_preparar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cfg jsonb; d record;
begin
  new.telefone := public.telefone_e164(new.telefone);
  new.documento := nullif(regexp_replace(coalesce(new.documento, ''), '\D', '', 'g'), '');
  new.email := nullif(lower(trim(new.email)), '');
  new.score := public.lead_pontuar(new);
  if tg_op = 'INSERT' and new.responsavel_id is null and new.status = 'novo' then
    select * into d from public.distribuir(new.empresa_id, 'lead', new.cliente_id, new.cidade, new.telefone, new.origem, new.interesse, new.campanha);
    new.responsavel_id := d.usuario_id;
    new.departamento_id := coalesce(new.departamento_id, d.departamento_id);
  end if;
  if new.responsavel_id is not null and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id) then
    v_cfg := public.parametros_leads(new.empresa_id);
    new.atribuido_em := now();
    if new.status = 'novo' and new.primeiro_contato_em is null then
      new.sla_ate := now() + make_interval(mins => greatest(1, (v_cfg->>'sla_minutos')::int));
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'novo' and new.status <> 'novo' and new.primeiro_contato_em is null then
    new.primeiro_contato_em := now();
  end if;
  if new.status = 'descartado' and coalesce(trim(new.motivo_descarte), '') = '' then
    raise exception 'Informe o motivo do descarte.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function public.lead_preparar() from public, anon, authenticated;
create trigger trg_leads_preparar before insert or update on public.leads for each row execute function public.lead_preparar();

create or replace function public.lead_notificar()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.responsavel_id is not null and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id) and new.status = 'novo' then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
    values (new.empresa_id, new.responsavel_id, 'Lead novo atribuído a você',
            left(new.nome || coalesce(' · ' || new.cidade, '') || coalesce(' · ' || new.interesse, '') || coalesce(' — primeiro contato em até ' || to_char(new.sla_ate at time zone 'America/Sao_Paulo', 'HH24:MI'), ''), 300),
            '/leads?id=' || new.id, 'lead:' || new.id || ':' || new.responsavel_id)
    on conflict (user_id, chave) where chave is not null do nothing;
  end if;
  return new;
end $$;
revoke execute on function public.lead_notificar() from public, anon, authenticated;
create trigger trg_leads_notificar after insert or update of responsavel_id on public.leads for each row execute function public.lead_notificar();

/**
 * Captação (endpoint público, WhatsApp, Lead Ads, importação). Chamada pelo servidor. Deduplica dentro da
 * empresa: lead aberto com o mesmo telefone/CPF/e-mail é atualizado (não cria outro); cliente existente
 * fica vinculado e o lead vai para o dono da carteira.
 */
create or replace function public.capturar_lead(p_empresa uuid, p_dados jsonb, p_origem text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tel text := public.telefone_e164(p_dados->>'telefone');
  v_doc text := nullif(regexp_replace(coalesce(p_dados->>'documento', ''), '\D', '', 'g'), '');
  v_email text := nullif(lower(trim(p_dados->>'email')), '');
  v_lead public.leads; v_cliente uuid;
begin
  if p_empresa is null or not exists (select 1 from public.empresas where id = p_empresa and status in ('trial', 'ativa')) then
    raise exception 'Empresa inválida.';
  end if;
  if coalesce(trim(p_dados->>'nome'), '') = '' and v_tel is null then raise exception 'Informe nome ou telefone.'; end if;
  if v_doc is not null and length(v_doc) not in (11, 14) then v_doc := null; end if;
  select l.* into v_lead from public.leads l
   where l.empresa_id = p_empresa and l.excluido_em is null and l.status not in ('convertido', 'descartado')
     and ((v_tel is not null and l.telefone = v_tel) or (v_doc is not null and l.documento = v_doc) or (v_email is not null and l.email = v_email))
   order by l.created_at desc limit 1 for update;
  select c.id into v_cliente from public.clientes c
   where c.empresa_id = p_empresa and c.excluido_em is null
     and ((v_doc is not null and c.documento = v_doc)
          or (v_tel is not null and (public.telefone_e164(c.whatsapp) = v_tel or public.telefone_e164(c.telefone) = v_tel)))
   limit 1;
  if v_lead.id is not null then
    update public.leads set
      nome = coalesce(nullif(trim(p_dados->>'nome'), ''), nome), email = coalesce(v_email, email), documento = coalesce(v_doc, documento),
      cidade = coalesce(nullif(trim(p_dados->>'cidade'), ''), cidade), interesse = coalesce(nullif(trim(p_dados->>'interesse'), ''), interesse),
      campanha = coalesce(nullif(trim(p_dados->>'campanha'), ''), campanha), cliente_id = coalesce(cliente_id, v_cliente),
      dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object('ultima_captacao', now(), 'ultima_origem', p_origem)
     where id = v_lead.id;
    return jsonb_build_object('lead_id', v_lead.id, 'novo', false, 'responsavel_id', v_lead.responsavel_id, 'cliente_id', v_cliente);
  end if;
  insert into public.leads (empresa_id, nome, telefone, email, documento, cidade, uf, origem, campanha, utm, interesse, renda_informada, cliente_id, observacoes, dados, created_by)
  values (p_empresa, left(coalesce(nullif(trim(p_dados->>'nome'), ''), 'Contato ' || right(coalesce(v_tel, ''), 4)), 200), v_tel, v_email, v_doc,
          left(nullif(trim(p_dados->>'cidade'), ''), 120), upper(left(nullif(trim(p_dados->>'uf'), ''), 2)),
          case when p_origem in ('whatsapp', 'site', 'lead_ads', 'indicacao', 'consultor', 'importacao') then p_origem else 'outro' end,
          left(nullif(trim(p_dados->>'campanha'), ''), 200), case when jsonb_typeof(p_dados->'utm') = 'object' then p_dados->'utm' end,
          left(nullif(trim(p_dados->>'interesse'), ''), 500),
          case when (p_dados->>'renda') ~ '^\d+(\.\d+)?$' then (p_dados->>'renda')::numeric end,
          v_cliente, left(nullif(trim(p_dados->>'mensagem'), ''), 4000), p_dados - 'telefone' - 'documento' - 'email' - 'nome', auth.uid())
  returning * into v_lead;
  return jsonb_build_object('lead_id', v_lead.id, 'novo', true, 'responsavel_id', v_lead.responsavel_id, 'cliente_id', v_cliente);
end $$;
revoke execute on function public.capturar_lead(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.capturar_lead(uuid, jsonb, text) to service_role;

-- Cadastro manual pela equipe (mesma deduplicação)
create or replace function public.novo_lead(p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.tem_permissao('leads.write') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return public.capturar_lead(public.empresa_atual(), p_dados, coalesce(p_dados->>'origem', 'consultor'));
end $$;

-- Conversão: lead vira cliente (pré-cadastro) mantendo origem e campanha (ROI por campanha)
create or replace function public.converter_lead(p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.leads; v_cli uuid;
begin
  if not public.tem_permissao('leads.write') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into l from public.leads where id = p_lead and empresa_id = public.empresa_atual() and excluido_em is null for update;
  if not found then raise exception 'Lead não encontrado.'; end if;
  if l.status = 'convertido' then return l.cliente_id; end if;
  if not (public.is_manager() or public.tem_permissao('leads.distribuir') or l.responsavel_id = auth.uid() or public.is_supervisor_de(l.responsavel_id)) then
    raise exception 'O lead é de outro responsável.' using errcode = '42501';
  end if;
  v_cli := l.cliente_id;
  if v_cli is null and l.documento is not null then
    select id into v_cli from public.clientes where empresa_id = l.empresa_id and documento = l.documento and excluido_em is null;
  end if;
  if v_cli is null then
    insert into public.clientes (empresa_id, nome, documento, telefone, whatsapp, email, cidade, uf, origem, status_cadastro, consultor_id, observacoes)
    values (l.empresa_id, l.nome, l.documento, l.telefone, l.telefone, l.email, l.cidade, l.uf,
            'lead_' || l.origem || coalesce(':' || l.campanha, ''), 'pre_cadastro', coalesce(l.responsavel_id, auth.uid()),
            nullif(concat_ws(E'\n', 'Interesse: ' || l.interesse, l.observacoes), ''))
    returning id into v_cli;
  end if;
  update public.leads set status = 'convertido', cliente_id = v_cli, convertido_em = now(), primeiro_contato_em = coalesce(primeiro_contato_em, now()) where id = p_lead;
  update public.wa_contatos set cliente_id = v_cli where empresa_id = l.empresa_id and lead_id = p_lead and cliente_id is null;
  return v_cli;
end $$;

-- SLA do primeiro contato (rotina a cada 5 min): redistribui e avisa o supervisor
create or replace function public.processar_sla_leads()
returns int language plpgsql security definer set search_path = '' as $$
declare l record; d record; n int := 0; v_cfg jsonb; v_sup uuid;
begin
  for l in select * from public.leads where status = 'novo' and primeiro_contato_em is null and sla_ate < now() and excluido_em is null
            order by sla_ate limit 500 for update skip locked loop
    v_cfg := public.parametros_leads(l.empresa_id);
    for v_sup in select distinct e.supervisor_id from public.equipe_membros e where e.empresa_id = l.empresa_id and e.membro_id = l.responsavel_id loop
      insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
      values (l.empresa_id, v_sup, 'SLA de lead estourado', left(l.nome || ' ficou sem primeiro contato no prazo', 300), '/leads?id=' || l.id, 'lead-sla:' || l.id || ':' || l.redistribuicoes)
      on conflict (user_id, chave) where chave is not null do nothing;
    end loop;
    if l.redistribuicoes < (v_cfg->>'max_redistribuicoes')::int then
      select * into d from public.distribuir(l.empresa_id, 'lead', l.cliente_id, l.cidade, l.telefone, l.origem, l.interesse, l.campanha, l.responsavel_id);
      update public.leads set sla_estourado = true, redistribuicoes = redistribuicoes + 1,
             responsavel_id = coalesce(d.usuario_id, responsavel_id), departamento_id = coalesce(d.departamento_id, departamento_id),
             sla_ate = case when d.usuario_id is null then null else sla_ate end
       where id = l.id;
    else
      update public.leads set sla_estourado = true, sla_ate = null where id = l.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.processar_sla_leads() from public, anon, authenticated;
select cron.schedule('geeasy-leads-sla', '*/5 * * * *', $$select public.processar_sla_leads()$$);

-- Funil por origem/campanha/responsável, tempo médio por etapa e motivos de descarte
create or replace function public.relatorio_leads(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual();
begin
  if not (public.tem_permissao('leads.view') or public.tem_permissao('relatorios.view')) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'por_origem', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select origem, coalesce(campanha, '—') as campanha, count(*) as total, count(*) filter (where status = 'convertido') as convertidos,
               count(*) filter (where status = 'descartado') as descartados, round(avg(score)) as score_medio
          from public.leads where empresa_id = v_emp and excluido_em is null and created_at::date between p_inicio and p_fim group by 1, 2) x),
    'por_responsavel', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select responsavel_id, count(*) as total, count(*) filter (where status = 'convertido') as convertidos,
               count(*) filter (where sla_estourado) as sla_estourado,
               round(avg(extract(epoch from primeiro_contato_em - atribuido_em) / 60) filter (where primeiro_contato_em is not null)) as min_ate_contato
          from public.leads where empresa_id = v_emp and excluido_em is null and created_at::date between p_inicio and p_fim group by 1) x),
    'tempo_medio', (select jsonb_build_object(
        'ate_contato_min', round(avg(extract(epoch from primeiro_contato_em - created_at) / 60) filter (where primeiro_contato_em is not null)),
        'ate_conversao_h', round(avg(extract(epoch from convertido_em - created_at) / 3600) filter (where convertido_em is not null)))
        from public.leads where empresa_id = v_emp and excluido_em is null and created_at::date between p_inicio and p_fim),
    'descartes', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select coalesce(motivo_descarte, '—') as motivo, count(*) as total from public.leads
         where empresa_id = v_emp and status = 'descartado' and created_at::date between p_inicio and p_fim group by 1) x)
  );
end $$;

-- ---------------------------------------------------------------------
-- WhatsApp
-- ---------------------------------------------------------------------
create table public.wa_numeros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 120),
  numero text not null check (numero ~ '^\d{12,15}$'),
  phone_number_id text not null unique check (phone_number_id ~ '^\d{5,30}$'),
  waba_id text check (waba_id ~ '^\d{5,30}$'),
  departamento_id uuid references public.departamentos(id) on delete set null,
  horario jsonb not null default '{"dias":[1,2,3,4,5],"inicio":"08:00","fim":"18:00"}'::jsonb,
  msg_boas_vindas text check (char_length(msg_boas_vindas) <= 1000),
  msg_fora_horario text check (char_length(msg_fora_horario) <= 1000),
  menu jsonb not null default '[]'::jsonb, -- [{"opcao":"1","rotulo":"Comercial","departamento_id":"..."}]
  sla_resposta_min int not null default 30 check (sla_resposta_min between 1 and 1440),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
-- token da Meta: só o servidor lê (RLS sem políticas), criptografado pela aplicação
create table public.wa_credenciais (
  numero_id uuid primary key references public.wa_numeros(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  token_enc text not null,
  atualizado_em timestamptz not null default now()
);

create table public.wa_contatos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  telefone text not null check (telefone ~ '^\d{12,15}$'),
  nome text check (char_length(nome) <= 200),
  cliente_id uuid references public.clientes(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  optin_em timestamptz,
  optin_origem text check (char_length(optin_origem) <= 120),
  optin_texto text check (char_length(optin_texto) <= 1000),
  optout_em timestamptz,
  etiquetas text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (empresa_id, telefone)
);
create index on public.wa_contatos (empresa_id, cliente_id) where cliente_id is not null;

create table public.wa_conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  contato_id uuid not null references public.wa_contatos(id) on delete cascade,
  numero_id uuid not null references public.wa_numeros(id) on delete restrict,
  status public.wa_conversa_status not null default 'aguardando_atendente',
  departamento_id uuid references public.departamentos(id) on delete set null,
  atendente_id uuid references public.profiles(id) on delete set null,
  prioridade int not null default 0 check (prioridade between 0 and 3),
  etiquetas text[] not null default '{}',
  janela_ate timestamptz,
  menu_pendente boolean not null default false,
  primeira_entrada_em timestamptz,
  ultima_entrada_em timestamptz,
  ultima_mensagem_em timestamptz,
  primeira_resposta_em timestamptz,
  sla_ate timestamptz,
  resolvida_em timestamptz,
  motivo_encerramento text check (char_length(motivo_encerramento) <= 300),
  resultado text check (resultado in ('venda', 'duvida', 'documento_recebido', 'suporte', 'sem_retorno', 'outro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index wa_conversas_aberta_uniq on public.wa_conversas (empresa_id, contato_id, numero_id) where status not in ('resolvida', 'arquivada');
create index on public.wa_conversas (empresa_id, status, departamento_id, atendente_id, ultima_mensagem_em desc);
create index on public.wa_conversas (empresa_id, atendente_id) where status not in ('resolvida', 'arquivada');
create trigger trg_wa_conversas_updated before update on public.wa_conversas for each row execute function public.set_updated_at();

-- Mensagens: alto volume => particionada por mês
create table public.wa_mensagens (
  id uuid not null default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  conversa_id uuid not null,
  direcao text not null check (direcao in ('entrada', 'saida', 'nota')),
  tipo text not null default 'texto' check (tipo in ('texto', 'imagem', 'audio', 'video', 'documento', 'localizacao', 'modelo', 'interativo', 'sistema', 'reacao', 'sticker', 'contato')),
  conteudo text check (char_length(conteudo) <= 8000),
  midia_path text,
  midia_mime text,
  midia_nome text,
  meta_id text,
  status text not null default 'recebida' check (status in ('recebida', 'pendente', 'enviada', 'entregue', 'lida', 'falhou')),
  erro text,
  tentativas int not null default 0,
  autor_id uuid,
  modelo_id uuid,
  parametros jsonb, -- variáveis do modelo, na ordem ({{1}}, {{2}}, ...)
  campanha_envio_id uuid,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);
create table public.wa_mensagens_padrao partition of public.wa_mensagens default;
create index on public.wa_mensagens (conversa_id, created_at);
create index on public.wa_mensagens (empresa_id, status, created_at) where status = 'pendente';
-- id da Meta => mensagem (idempotência dos webhooks e atualização de status)
create table public.wa_ids (
  meta_id text primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mensagem_id uuid not null,
  mensagem_em timestamptz not null
);

create or replace function public.wa_criar_particoes(p_meses_a_frente int default 3)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ini date := date_trunc('month', now())::date; v_ate date := (date_trunc('month', now()) + make_interval(months => p_meses_a_frente))::date; v_nome text;
begin
  while v_ini <= v_ate loop
    v_nome := 'wa_mensagens_' || to_char(v_ini, 'YYYY_MM');
    if to_regclass('public.' || v_nome) is null then
      execute format('create table public.%I partition of public.wa_mensagens for values from (%L) to (%L)', v_nome, v_ini, (v_ini + interval '1 month')::date);
      execute format('alter table public.%I enable row level security', v_nome);
      execute format('revoke all on public.%I from anon, authenticated', v_nome);
    end if;
    v_ini := (v_ini + interval '1 month')::date;
  end loop;
end $$;
revoke execute on function public.wa_criar_particoes(int) from public, anon, authenticated;
alter table public.wa_mensagens_padrao enable row level security;
revoke all on public.wa_mensagens_padrao from anon, authenticated;
select public.wa_criar_particoes(3);
select cron.schedule('geeasy-wa-particoes', '0 4 20 * *', $$select public.wa_criar_particoes(3)$$);

create table public.wa_modelos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  numero_id uuid references public.wa_numeros(id) on delete cascade,
  nome text not null check (nome ~ '^[a-z0-9_]+$' and char_length(nome) <= 512),
  idioma text not null default 'pt_BR' check (char_length(idioma) <= 10),
  categoria text not null default 'utility' check (categoria in ('marketing', 'utility', 'authentication')),
  corpo text not null check (char_length(corpo) <= 1024),
  variaveis int not null default 0 check (variaveis between 0 and 20),
  status text not null default 'aprovado' check (status in ('aprovado', 'pendente', 'rejeitado', 'pausado')),
  created_at timestamptz not null default now(),
  unique (empresa_id, nome, idioma)
);

create table public.wa_campanhas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 160),
  numero_id uuid not null references public.wa_numeros(id) on delete restrict,
  modelo_id uuid not null references public.wa_modelos(id) on delete restrict,
  filtro jsonb not null default '{}'::jsonb,
  variaveis jsonb not null default '[]'::jsonb, -- ["{{nome}}", "texto fixo", ...]
  agendada_para timestamptz,
  limite_hora int not null default 200 check (limite_hora between 1 and 10000),
  status text not null default 'rascunho' check (status in ('rascunho', 'agendada', 'enviando', 'concluida', 'cancelada')),
  totais jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.wa_campanha_envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete restrict,
  campanha_id uuid not null references public.wa_campanhas(id) on delete cascade,
  contato_id uuid not null references public.wa_contatos(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'entregue', 'lido', 'respondido', 'falhou', 'ignorado_optout')),
  meta_id text,
  erro text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (campanha_id, contato_id)
);
create index on public.wa_campanha_envios (campanha_id, status);

-- Fila de webhooks (WhatsApp, Lead Ads, cobrança): gravados na hora, processados depois (idempotente)
create table public.webhook_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas(id) on delete cascade,
  origem text not null check (origem in ('whatsapp', 'meta_leads', 'cobranca')),
  externo_id text not null,
  payload jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'processado', 'erro', 'ignorado')),
  tentativas int not null default 0,
  proximo_em timestamptz not null default now(),
  erro text,
  created_at timestamptz not null default now(),
  processado_em timestamptz,
  unique (origem, externo_id)
);
create index on public.webhook_eventos (origem, status, proximo_em) where status in ('pendente', 'erro');
alter table public.webhook_eventos enable row level security;
alter table public.wa_credenciais enable row level security;
alter table public.wa_ids enable row level security;
revoke all on public.webhook_eventos, public.wa_credenciais, public.wa_ids from anon, authenticated;

-- reserva de eventos para o processador (FOR UPDATE SKIP LOCKED; nova tentativa com espera exponencial)
create or replace function public.reservar_eventos(p_origem text, p_limite int default 50)
returns setof public.webhook_eventos language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.webhook_eventos e set status = 'processando', tentativas = e.tentativas + 1, proximo_em = now()
   where e.id in (select x.id from public.webhook_eventos x
                   where x.origem = p_origem and (x.status = 'pendente' or (x.status = 'erro' and x.tentativas < 8)) and x.proximo_em <= now()
                   order by x.id limit greatest(1, least(p_limite, 500)) for update skip locked)
     or (e.origem = p_origem and e.status = 'processando' and e.proximo_em < now() - interval '10 minutes' and e.tentativas < 8)
  returning e.*;
end $$;
create or replace function public.concluir_evento(p_id bigint, p_ok boolean, p_erro text default null)
returns void language sql security definer set search_path = '' as $$
  update public.webhook_eventos set
    status = case when p_ok then 'processado' else 'erro' end, processado_em = case when p_ok then now() end,
    erro = left(p_erro, 1000), proximo_em = case when p_ok then proximo_em else now() + make_interval(mins => least(power(2, tentativas)::int, 720)) end
   where id = p_id
$$;
revoke execute on function public.reservar_eventos(text, int), public.concluir_evento(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.reservar_eventos(text, int), public.concluir_evento(bigint, boolean, text) to service_role;

-- integridade e auditoria
create trigger zz_empresa_vinculos before insert or update on public.wa_numeros for each row execute function public.empresa_vinculos('departamento_id:departamentos');
create trigger zz_empresa_vinculos before insert or update on public.wa_contatos for each row execute function public.empresa_vinculos('cliente_id:clientes', 'lead_id:leads');
create trigger zz_empresa_vinculos before insert or update on public.wa_conversas for each row execute function public.empresa_vinculos('contato_id:wa_contatos', 'numero_id:wa_numeros', 'departamento_id:departamentos', 'atendente_id:@');
create trigger zz_empresa_vinculos before insert or update on public.wa_modelos for each row execute function public.empresa_vinculos('numero_id:wa_numeros');
create trigger zz_empresa_vinculos before insert or update on public.wa_campanhas for each row execute function public.empresa_vinculos('numero_id:wa_numeros', 'modelo_id:wa_modelos');
do $$
declare t text;
begin
  foreach t in array array['wa_numeros', 'wa_contatos', 'wa_conversas', 'wa_modelos', 'wa_campanhas'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Visibilidade das conversas: atendente vê a sua fila/carteira; supervisor vê a equipe; supervisão/master tudo
-- ---------------------------------------------------------------------
create or replace function public.pode_ver_conversa(p_atendente uuid, p_departamento uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin_master() or public.tem_permissao('whatsapp.supervisionar')
      or (public.tem_permissao('whatsapp.atender') and (p_atendente = auth.uid()
          or (p_atendente is null and (p_departamento is null or public.is_membro_departamento(p_departamento)))
          or public.is_supervisor_de(p_atendente)))
$$;
revoke execute on function public.pode_ver_conversa(uuid, uuid) from public, anon;
grant execute on function public.pode_ver_conversa(uuid, uuid) to authenticated;

alter table public.leads enable row level security;
alter table public.distribuicao_regras enable row level security;
alter table public.wa_numeros enable row level security;
alter table public.wa_contatos enable row level security;
alter table public.wa_conversas enable row level security;
alter table public.wa_mensagens enable row level security;
alter table public.wa_modelos enable row level security;
alter table public.wa_campanhas enable row level security;
alter table public.wa_campanha_envios enable row level security;

create policy leads_select on public.leads for select to authenticated
  using ((select public.tem_permissao('leads.view')) and (responsavel_id = (select auth.uid()) or (select public.tem_permissao('leads.distribuir'))
         or (select public.is_manager()) or public.is_supervisor_de(responsavel_id) or (responsavel_id is null and public.is_membro_departamento(departamento_id))));
create policy leads_insert on public.leads for insert to authenticated with check ((select public.tem_permissao('leads.write')));
create policy leads_update on public.leads for update to authenticated
  using ((select public.tem_permissao('leads.write')) and (responsavel_id = (select auth.uid()) or (select public.tem_permissao('leads.distribuir')) or (select public.is_manager()) or (responsavel_id is null and public.is_membro_departamento(departamento_id))))
  with check ((select public.tem_permissao('leads.write')));
create policy leads_delete on public.leads for delete to authenticated using ((select public.tem_permissao('leads.distribuir')) or (select public.is_manager()));

create policy regras_select on public.distribuicao_regras for select to authenticated using ((select public.is_active_user()));
create policy regras_insert on public.distribuicao_regras for insert to authenticated with check ((select public.tem_permissao('leads.distribuir')));
create policy regras_update on public.distribuicao_regras for update to authenticated using ((select public.tem_permissao('leads.distribuir')));
create policy regras_delete on public.distribuicao_regras for delete to authenticated using ((select public.tem_permissao('leads.distribuir')));

create policy wa_numeros_select on public.wa_numeros for select to authenticated using ((select public.tem_permissao('whatsapp.atender')) or (select public.tem_permissao('whatsapp.configurar')));
create policy wa_numeros_insert on public.wa_numeros for insert to authenticated with check ((select public.tem_permissao('whatsapp.configurar')));
create policy wa_numeros_update on public.wa_numeros for update to authenticated using ((select public.tem_permissao('whatsapp.configurar')));

create policy wa_conversas_select on public.wa_conversas for select to authenticated using (public.pode_ver_conversa(atendente_id, departamento_id));
create policy wa_contatos_select on public.wa_contatos for select to authenticated
  using ((select public.tem_permissao('whatsapp.campanhas')) or (select public.tem_permissao('whatsapp.supervisionar'))
         or exists (select 1 from public.wa_conversas c where c.contato_id = wa_contatos.id));
create policy wa_contatos_update on public.wa_contatos for update to authenticated
  using ((select public.tem_permissao('whatsapp.atender'))) with check ((select public.tem_permissao('whatsapp.atender')));
create policy wa_mensagens_select on public.wa_mensagens for select to authenticated
  using (exists (select 1 from public.wa_conversas c where c.id = wa_mensagens.conversa_id));
create policy wa_modelos_select on public.wa_modelos for select to authenticated using ((select public.tem_permissao('whatsapp.atender')) or (select public.tem_permissao('whatsapp.campanhas')));
create policy wa_modelos_insert on public.wa_modelos for insert to authenticated with check ((select public.tem_permissao('whatsapp.configurar')) or (select public.tem_permissao('whatsapp.campanhas')));
create policy wa_modelos_update on public.wa_modelos for update to authenticated using ((select public.tem_permissao('whatsapp.configurar')) or (select public.tem_permissao('whatsapp.campanhas')));
create policy wa_campanhas_select on public.wa_campanhas for select to authenticated using ((select public.tem_permissao('whatsapp.campanhas')));
create policy wa_campanhas_insert on public.wa_campanhas for insert to authenticated with check ((select public.tem_permissao('whatsapp.campanhas')) and status in ('rascunho', 'agendada'));
create policy wa_campanhas_update on public.wa_campanhas for update to authenticated using ((select public.tem_permissao('whatsapp.campanhas')) and status in ('rascunho', 'agendada', 'enviando'));
create policy wa_envios_select on public.wa_campanha_envios for select to authenticated using ((select public.tem_permissao('whatsapp.campanhas')));

do $$
declare t text;
begin
  foreach t in array array['leads', 'distribuicao_regras', 'wa_numeros', 'wa_contatos', 'wa_conversas', 'wa_mensagens', 'wa_modelos', 'wa_campanhas', 'wa_campanha_envios'] loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Entrada de mensagens (processador do servidor, a partir da fila de webhooks)
-- ---------------------------------------------------------------------
create or replace function public.wa_dentro_do_horario(p_horario jsonb, p_fuso text)
returns boolean language sql stable set search_path = '' as $$
  select extract(isodow from now() at time zone p_fuso)::int in (select (x)::int from jsonb_array_elements_text(coalesce(p_horario->'dias', '[1,2,3,4,5]')) x)
     and (now() at time zone p_fuso)::time between coalesce((p_horario->>'inicio')::time, '08:00') and coalesce((p_horario->>'fim')::time, '18:00')
$$;

-- Fila de respostas automáticas/manuais a enviar (o processador do servidor envia pela API da Meta)
create or replace function public.wa_enfileirar_saida(p_conversa uuid, p_tipo text, p_conteudo text, p_autor uuid, p_modelo uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_emp uuid;
begin
  select empresa_id into v_emp from public.wa_conversas where id = p_conversa;
  insert into public.wa_mensagens (id, empresa_id, conversa_id, direcao, tipo, conteudo, status, autor_id, modelo_id)
  values (v_id, v_emp, p_conversa, 'saida', p_tipo, left(p_conteudo, 8000), 'pendente', p_autor, p_modelo);
  update public.wa_conversas set ultima_mensagem_em = now() where id = p_conversa;
  return v_id;
end $$;
revoke execute on function public.wa_enfileirar_saida(uuid, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.wa_receber_mensagem(p_numero_id uuid, p_telefone text, p_nome text, p_meta_id text, p_tipo text,
  p_conteudo text, p_midia_path text, p_midia_mime text, p_midia_nome text, p_em timestamptz, p_referral jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.wa_numeros; v_tel text := public.telefone_e164(p_telefone); ct public.wa_contatos; cv public.wa_conversas;
  v_msg uuid := gen_random_uuid(); v_em timestamptz := coalesce(p_em, now()); v_fuso text; d record; v_lead jsonb; v_nova boolean := false;
  v_opcao jsonb; v_cliente uuid;
begin
  if exists (select 1 from public.wa_ids where meta_id = p_meta_id) then return jsonb_build_object('repetida', true); end if;
  select * into n from public.wa_numeros where id = p_numero_id and ativo;
  if not found or v_tel is null then raise exception 'Número ou telefone inválido.'; end if;
  select fuso into v_fuso from public.empresas where id = n.empresa_id;

  -- contato (vincula a cliente pelo telefone; sem cliente nem lead aberto, nasce um lead de origem WhatsApp)
  insert into public.wa_contatos (empresa_id, telefone, nome) values (n.empresa_id, v_tel, left(p_nome, 200))
  on conflict (empresa_id, telefone) do update set nome = coalesce(public.wa_contatos.nome, excluded.nome)
  returning * into ct;
  if ct.cliente_id is null then
    select c.id into v_cliente from public.clientes c
     where c.empresa_id = n.empresa_id and c.excluido_em is null and (public.telefone_e164(c.whatsapp) = v_tel or public.telefone_e164(c.telefone) = v_tel) limit 1;
    if v_cliente is not null then update public.wa_contatos set cliente_id = v_cliente where id = ct.id returning * into ct; end if;
  end if;
  if ct.cliente_id is null and (ct.lead_id is null or not exists (select 1 from public.leads l where l.id = ct.lead_id and l.status not in ('convertido', 'descartado'))) then
    v_lead := public.capturar_lead(n.empresa_id, jsonb_build_object('nome', coalesce(p_nome, ''), 'telefone', v_tel, 'mensagem', left(p_conteudo, 500),
                 'campanha', coalesce(p_referral->>'headline', p_referral->>'source_id'), 'utm', p_referral), 'whatsapp');
    update public.wa_contatos set lead_id = (v_lead->>'lead_id')::uuid where id = ct.id returning * into ct;
  end if;

  -- conversa aberta ou nova (roteamento: dono da carteira → menu → regras → fila do número)
  select * into cv from public.wa_conversas where empresa_id = n.empresa_id and contato_id = ct.id and numero_id = n.id and status not in ('resolvida', 'arquivada') for update;
  if not found then
    v_nova := true;
    select * into d from public.distribuir(n.empresa_id, 'whatsapp', ct.cliente_id, null, v_tel, 'whatsapp', p_conteudo, p_referral->>'headline');
    if d.usuario_id is null and d.departamento_id is null and ct.lead_id is not null then
      select l.responsavel_id, l.departamento_id into d.usuario_id, d.departamento_id from public.leads l where l.id = ct.lead_id;
    end if;
    insert into public.wa_conversas (empresa_id, contato_id, numero_id, status, departamento_id, atendente_id, primeira_entrada_em, menu_pendente)
    values (n.empresa_id, ct.id, n.id, 'aguardando_atendente', coalesce(d.departamento_id, case when d.usuario_id is null then n.departamento_id end), d.usuario_id, v_em,
            d.usuario_id is null and jsonb_array_length(n.menu) > 0)
    returning * into cv;
  end if;

  insert into public.wa_mensagens (id, empresa_id, conversa_id, direcao, tipo, conteudo, midia_path, midia_mime, midia_nome, meta_id, status, created_at)
  values (v_msg, n.empresa_id, cv.id, 'entrada', coalesce(p_tipo, 'texto'), left(p_conteudo, 8000), p_midia_path, p_midia_mime, left(p_midia_nome, 200), p_meta_id, 'recebida', v_em);
  insert into public.wa_ids (meta_id, empresa_id, mensagem_id, mensagem_em) values (p_meta_id, n.empresa_id, v_msg, v_em);
  -- resposta a campanha recente e descadastro por palavra-chave
  update public.wa_campanha_envios set status = 'respondido'
   where contato_id = ct.id and status in ('enviado', 'entregue', 'lido') and enviado_em > now() - interval '7 days';
  if upper(trim(coalesce(p_conteudo, ''))) in ('SAIR', 'PARAR', 'STOP', 'DESCADASTRAR', 'CANCELAR INSCRIÇÃO') then
    update public.wa_contatos set optout_em = now() where id = ct.id;
    perform public.wa_enfileirar_saida(cv.id, 'texto', 'Pronto, você não receberá mais mensagens promocionais. Para voltar, é só nos avisar.', null);
  end if;

  -- menu inicial: a resposta com uma opção válida encaminha ao departamento
  if cv.menu_pendente and not v_nova then
    select x into v_opcao from jsonb_array_elements(n.menu) x where x->>'opcao' = trim(coalesce(p_conteudo, '')) limit 1;
    if v_opcao is not null then
      update public.wa_conversas set menu_pendente = false, departamento_id = nullif(v_opcao->>'departamento_id', '')::uuid where id = cv.id;
      perform public.wa_enfileirar_saida(cv.id, 'texto', 'Certo! Já vamos te atender em ' || (v_opcao->>'rotulo') || '.', null);
    end if;
  end if;

  update public.wa_conversas set
    janela_ate = v_em + interval '24 hours', ultima_entrada_em = v_em, ultima_mensagem_em = v_em,
    status = case when status in ('aguardando_cliente', 'aberta') or v_nova then 'aguardando_atendente' else status end,
    sla_ate = case when primeira_resposta_em is null and sla_ate is null then v_em + make_interval(mins => n.sla_resposta_min) else sla_ate end
   where id = cv.id
  returning * into cv;

  -- respostas automáticas na primeira mensagem: fora do horário, boas-vindas e menu
  if v_nova then
    if not public.wa_dentro_do_horario(n.horario, coalesce(v_fuso, 'America/Sao_Paulo')) and coalesce(n.msg_fora_horario, '') <> '' then
      perform public.wa_enfileirar_saida(cv.id, 'texto', n.msg_fora_horario, null);
    elsif coalesce(n.msg_boas_vindas, '') <> '' then
      perform public.wa_enfileirar_saida(cv.id, 'texto', n.msg_boas_vindas, null);
    end if;
    if cv.menu_pendente then
      perform public.wa_enfileirar_saida(cv.id, 'texto',
        'Escolha uma opção:' || E'\n' || (select string_agg((x->>'opcao') || ' - ' || (x->>'rotulo'), E'\n') from jsonb_array_elements(n.menu) x), null);
    end if;
  end if;

  -- aviso ao atendente (ou à equipe do departamento)
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select n.empresa_id, u, 'Mensagem de WhatsApp', left(coalesce(ct.nome, ct.telefone) || ': ' || coalesce(p_conteudo, '[' || p_tipo || ']'), 300), '/whatsapp?c=' || cv.id, 'wa:' || cv.id || ':' || to_char(now(), 'YYYYMMDDHH24MI')
    from (select cv.atendente_id as u where cv.atendente_id is not null
          union select dm.user_id from public.departamento_membros dm where cv.atendente_id is null and dm.departamento_id = cv.departamento_id and dm.ativo) x
   where u is not null
  on conflict (user_id, chave) where chave is not null do nothing;
  return jsonb_build_object('conversa_id', cv.id, 'mensagem_id', v_msg, 'nova', v_nova, 'contato_id', ct.id);
end $$;
revoke execute on function public.wa_receber_mensagem(uuid, text, text, text, text, text, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.wa_receber_mensagem(uuid, text, text, text, text, text, text, text, text, timestamptz, jsonb) to service_role;

create or replace function public.wa_atualizar_status(p_meta_id text, p_status text, p_erro text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.wa_ids; v_ordem int;
begin
  if p_status not in ('enviada', 'entregue', 'lida', 'falhou') then return; end if;
  -- envios de campanha não têm mensagem na conversa: o status vai direto para o envio
  update public.wa_campanha_envios set status = case p_status when 'entregue' then 'entregue' when 'lida' then 'lido' when 'falhou' then 'falhou' else status end,
         erro = case when p_status = 'falhou' then left(p_erro, 500) else erro end
   where meta_id = p_meta_id and status not in ('respondido');
  select * into i from public.wa_ids where meta_id = p_meta_id;
  if not found then return; end if;
  v_ordem := case p_status when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 9 end;
  update public.wa_mensagens set status = p_status, erro = coalesce(left(p_erro, 500), erro)
   where id = i.mensagem_id and created_at = i.mensagem_em
     and (p_status = 'falhou' or case status when 'pendente' then 0 when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 0 end < v_ordem);
end $$;
-- o servidor registra o envio feito pela API (id da Meta para os status seguintes)
create or replace function public.wa_marcar_envio(p_mensagem uuid, p_meta_id text, p_erro text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  select id, created_at, empresa_id, tentativas into m from public.wa_mensagens where id = p_mensagem;
  if not found then return; end if;
  if p_meta_id is not null then
    update public.wa_mensagens set status = 'enviada', meta_id = p_meta_id, erro = null where id = m.id and created_at = m.created_at;
    insert into public.wa_ids (meta_id, empresa_id, mensagem_id, mensagem_em) values (p_meta_id, m.empresa_id, m.id, m.created_at) on conflict do nothing;
  else
    update public.wa_mensagens set tentativas = tentativas + 1, erro = left(p_erro, 500), status = case when tentativas + 1 >= 5 then 'falhou' else 'pendente' end
     where id = m.id and created_at = m.created_at;
  end if;
end $$;
revoke execute on function public.wa_atualizar_status(text, text, text), public.wa_marcar_envio(uuid, text, text) from public, anon, authenticated;
grant execute on function public.wa_atualizar_status(text, text, text), public.wa_marcar_envio(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Atendimento (usuário)
-- ---------------------------------------------------------------------
-- Envio: texto livre só dentro da janela de 24 h; fora dela, só modelo aprovado
create or replace function public.wa_enviar(p_conversa uuid, p_texto text, p_modelo uuid default null, p_variaveis jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cv public.wa_conversas; ct public.wa_contatos; md public.wa_modelos; v_id uuid; v_corpo text;
begin
  if not public.tem_permissao('whatsapp.atender') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into cv from public.wa_conversas where id = p_conversa and empresa_id = public.empresa_atual() for update;
  if not found or not public.pode_ver_conversa(cv.atendente_id, cv.departamento_id) then raise exception 'Conversa não encontrada.' using errcode = '42501'; end if;
  if cv.status in ('resolvida', 'arquivada') then raise exception 'A conversa está encerrada.'; end if;
  select * into ct from public.wa_contatos where id = cv.contato_id;
  if p_modelo is null then
    if coalesce(trim(p_texto), '') = '' then raise exception 'Mensagem vazia.'; end if;
    if cv.janela_ate is null or cv.janela_ate < now() then
      raise exception 'Fora da janela de 24 horas: use um modelo aprovado pela Meta.' using errcode = '23514';
    end if;
    v_id := public.wa_enfileirar_saida(cv.id, 'texto', p_texto, auth.uid());
  else
    select * into md from public.wa_modelos where id = p_modelo and empresa_id = cv.empresa_id and status = 'aprovado';
    if not found then raise exception 'Modelo não aprovado.'; end if;
    if md.categoria = 'marketing' and (ct.optout_em is not null or ct.optin_em is null) then
      raise exception 'O contato não autorizou mensagens de marketing (opt-in).' using errcode = '23514';
    end if;
    v_corpo := md.corpo;
    for i in 1..md.variaveis loop v_corpo := replace(v_corpo, '{{' || i || '}}', coalesce(p_variaveis->>(i - 1), '')); end loop;
    insert into public.wa_mensagens (empresa_id, conversa_id, direcao, tipo, conteudo, status, autor_id, modelo_id, parametros)
    values (cv.empresa_id, cv.id, 'saida', 'modelo', v_corpo, 'pendente', auth.uid(), md.id, case when jsonb_typeof(p_variaveis) = 'array' then p_variaveis end) returning id into v_id;
  end if;
  update public.wa_conversas set
    atendente_id = coalesce(atendente_id, auth.uid()), status = 'aguardando_cliente', ultima_mensagem_em = now(),
    primeira_resposta_em = coalesce(primeira_resposta_em, now()), menu_pendente = false
   where id = cv.id;
  if ct.lead_id is not null then
    update public.leads set status = 'em_contato' where id = ct.lead_id and status = 'novo';
  end if;
  return v_id;
end $$;

create or replace function public.wa_assumir(p_conversa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare cv public.wa_conversas;
begin
  if not public.tem_permissao('whatsapp.atender') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into cv from public.wa_conversas where id = p_conversa and empresa_id = public.empresa_atual() for update;
  if not found or not public.pode_ver_conversa(cv.atendente_id, cv.departamento_id) then raise exception 'Conversa não encontrada.' using errcode = '42501'; end if;
  if cv.atendente_id is not null and cv.atendente_id <> auth.uid() and not (public.tem_permissao('whatsapp.supervisionar') or public.is_supervisor_de(cv.atendente_id)) then
    raise exception 'A conversa já tem atendente.';
  end if;
  update public.wa_conversas set atendente_id = auth.uid(), status = case when status = 'aberta' then 'aguardando_atendente' else status end where id = p_conversa;
end $$;

create or replace function public.wa_transferir(p_conversa uuid, p_atendente uuid, p_departamento uuid, p_nota text)
returns void language plpgsql security definer set search_path = '' as $$
declare cv public.wa_conversas;
begin
  if not public.tem_permissao('whatsapp.atender') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into cv from public.wa_conversas where id = p_conversa and empresa_id = public.empresa_atual() for update;
  if not found or not public.pode_ver_conversa(cv.atendente_id, cv.departamento_id) then raise exception 'Conversa não encontrada.' using errcode = '42501'; end if;
  if p_atendente is null and p_departamento is null then raise exception 'Escolha o atendente ou o departamento.'; end if;
  update public.wa_conversas set atendente_id = p_atendente, departamento_id = coalesce(p_departamento, departamento_id), status = 'aguardando_atendente' where id = p_conversa;
  insert into public.wa_mensagens (empresa_id, conversa_id, direcao, tipo, conteudo, status, autor_id)
  values (cv.empresa_id, cv.id, 'nota', 'sistema', left('Transferida' || coalesce(': ' || nullif(trim(p_nota), ''), ''), 2000), 'recebida', auth.uid());
  if p_atendente is not null then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (cv.empresa_id, p_atendente, 'Conversa transferida para você', left(coalesce(p_nota, 'Nova conversa na sua fila'), 300), '/whatsapp?c=' || cv.id);
  end if;
end $$;

create or replace function public.wa_nota(p_conversa uuid, p_texto text)
returns void language plpgsql security definer set search_path = '' as $$
declare cv public.wa_conversas;
begin
  select * into cv from public.wa_conversas where id = p_conversa and empresa_id = public.empresa_atual();
  if not found or not public.pode_ver_conversa(cv.atendente_id, cv.departamento_id) then raise exception 'Conversa não encontrada.' using errcode = '42501'; end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Nota vazia.'; end if;
  insert into public.wa_mensagens (empresa_id, conversa_id, direcao, tipo, conteudo, status, autor_id)
  values (cv.empresa_id, cv.id, 'nota', 'texto', left(p_texto, 4000), 'recebida', auth.uid());
end $$;

create or replace function public.wa_encerrar(p_conversa uuid, p_resultado text, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare cv public.wa_conversas;
begin
  select * into cv from public.wa_conversas where id = p_conversa and empresa_id = public.empresa_atual() for update;
  if not found or not public.pode_ver_conversa(cv.atendente_id, cv.departamento_id) then raise exception 'Conversa não encontrada.' using errcode = '42501'; end if;
  if p_resultado not in ('venda', 'duvida', 'documento_recebido', 'suporte', 'sem_retorno', 'outro') then raise exception 'Resultado inválido.'; end if;
  update public.wa_conversas set status = 'resolvida', resolvida_em = now(), resultado = p_resultado, motivo_encerramento = left(p_motivo, 300) where id = p_conversa;
end $$;

-- Opt-in / opt-out (descadastro respeitado em campanhas)
create or replace function public.wa_consentimento(p_contato uuid, p_optin boolean, p_origem text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.tem_permissao('whatsapp.atender') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  update public.wa_contatos set
    optin_em = case when p_optin then now() else optin_em end, optin_origem = case when p_optin then left(p_origem, 120) else optin_origem end,
    optin_texto = case when p_optin then 'Aceite registrado pelo atendente' else optin_texto end, optout_em = case when p_optin then null else now() end
   where id = p_contato and empresa_id = public.empresa_atual();
end $$;

-- Métricas: primeira resposta, resolução, conversas por atendente, SLA estourado, conversão, custo estimado
create or replace function public.wa_metricas(p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_preco jsonb;
begin
  if not (public.tem_permissao('whatsapp.supervisionar') or public.tem_permissao('relatorios.view') or public.is_admin_master()) then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select coalesce(c.valor->'precos', '{"marketing":0.35,"utility":0.05,"authentication":0.05}'::jsonb) into v_preco from (select 1) x left join public.configuracoes c on c.empresa_id = v_emp and c.chave = 'whatsapp';
  return jsonb_build_object(
    'conversas', (select count(*) from public.wa_conversas where empresa_id = v_emp and created_at::date between p_inicio and p_fim),
    'primeira_resposta_min', (select round(avg(extract(epoch from primeira_resposta_em - primeira_entrada_em) / 60)) from public.wa_conversas where empresa_id = v_emp and created_at::date between p_inicio and p_fim and primeira_resposta_em is not null),
    'resolucao_h', (select round(avg(extract(epoch from resolvida_em - primeira_entrada_em) / 3600)::numeric, 1) from public.wa_conversas where empresa_id = v_emp and created_at::date between p_inicio and p_fim and resolvida_em is not null),
    'sla_estourado', (select count(*) from public.wa_conversas where empresa_id = v_emp and created_at::date between p_inicio and p_fim and sla_ate is not null and coalesce(primeira_resposta_em, now()) > sla_ate),
    'por_atendente', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
        select atendente_id, count(*) as total, count(*) filter (where status = 'resolvida') as resolvidas,
               round(avg(extract(epoch from primeira_resposta_em - primeira_entrada_em) / 60) filter (where primeira_resposta_em is not null)) as primeira_resposta_min
          from public.wa_conversas where empresa_id = v_emp and created_at::date between p_inicio and p_fim group by 1) x),
    'resultados', (select coalesce(jsonb_object_agg(coalesce(resultado, 'em_aberto'), n), '{}') from (select resultado, count(*) n from public.wa_conversas where empresa_id = v_emp and created_at::date between p_inicio and p_fim group by 1) x),
    'leads_whatsapp', (select jsonb_build_object('total', count(*), 'convertidos', count(*) filter (where status = 'convertido')) from public.leads where empresa_id = v_emp and origem = 'whatsapp' and created_at::date between p_inicio and p_fim),
    'mensagens_modelo', (select coalesce(jsonb_object_agg(categoria, n), '{}') from (select md.categoria, count(*) n from public.wa_mensagens m join public.wa_modelos md on md.id = m.modelo_id
        where m.empresa_id = v_emp and m.direcao = 'saida' and m.status in ('enviada', 'entregue', 'lida') and m.created_at::date between p_inicio and p_fim group by 1) x),
    'custo_estimado', (select coalesce(sum((v_preco->>md.categoria)::numeric), 0) from public.wa_mensagens m join public.wa_modelos md on md.id = m.modelo_id
        where m.empresa_id = v_emp and m.direcao = 'saida' and m.status in ('enviada', 'entregue', 'lida') and m.created_at::date between p_inicio and p_fim)
  );
end $$;

-- Campanhas: monta os envios (só contatos com opt-in e sem descadastro) e agenda
create or replace function public.wa_preparar_campanha(p_campanha uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare cp public.wa_campanhas; f jsonb; n int;
begin
  if not public.tem_permissao('whatsapp.campanhas') then raise exception 'Sem permissão.' using errcode = '42501'; end if;
  select * into cp from public.wa_campanhas where id = p_campanha and empresa_id = public.empresa_atual() for update;
  if not found or cp.status not in ('rascunho', 'agendada') then raise exception 'Campanha não pode ser preparada.'; end if;
  f := cp.filtro;
  insert into public.wa_campanha_envios (empresa_id, campanha_id, contato_id)
  select cp.empresa_id, cp.id, ct.id from public.wa_contatos ct left join public.clientes c on c.id = ct.cliente_id
   where ct.empresa_id = cp.empresa_id and ct.optin_em is not null and ct.optout_em is null
     and (f->>'etiqueta' is null or (f->>'etiqueta') = any(ct.etiquetas))
     and (f->>'cidade' is null or lower(c.cidade) = lower(f->>'cidade'))
     and (f->>'status_cadastro' is null or c.status_cadastro::text = f->>'status_cadastro')
     and (f->>'carteira' is null or c.carteira::text = f->>'carteira')
     and (coalesce((f->>'pendencia')::boolean, false) = false or c.status_cadastro in ('pendente_documentacao', 'transferido_administrativo'))
  on conflict do nothing;
  get diagnostics n = row_count;
  update public.wa_campanhas set status = 'agendada', agendada_para = coalesce(agendada_para, now()), totais = jsonb_build_object('destinatarios', (select count(*) from public.wa_campanha_envios where campanha_id = cp.id)) where id = cp.id;
  return n;
end $$;

revoke execute on function public.wa_enviar(uuid, text, uuid, jsonb), public.wa_assumir(uuid), public.wa_transferir(uuid, uuid, uuid, text), public.wa_nota(uuid, text),
  public.wa_encerrar(uuid, text, text), public.wa_consentimento(uuid, boolean, text), public.wa_metricas(date, date), public.wa_preparar_campanha(uuid),
  public.novo_lead(jsonb), public.converter_lead(uuid), public.relatorio_leads(date, date) from public, anon;
grant execute on function public.wa_enviar(uuid, text, uuid, jsonb), public.wa_assumir(uuid), public.wa_transferir(uuid, uuid, uuid, text), public.wa_nota(uuid, text),
  public.wa_encerrar(uuid, text, text), public.wa_consentimento(uuid, boolean, text), public.wa_metricas(date, date), public.wa_preparar_campanha(uuid),
  public.novo_lead(jsonb), public.converter_lead(uuid), public.relatorio_leads(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Regra dos 45 dias e desligamento: conversas e leads acompanham a carteira
-- ---------------------------------------------------------------------
create or replace function public.cliente_reatribuir_conversas()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dep uuid;
begin
  if new.carteira = 'administrativo' and old.carteira is distinct from 'administrativo' then
    select d.id into v_dep from public.departamentos d where d.empresa_id = new.empresa_id and d.tipo = 'administrativo' and d.ativo order by d.created_at limit 1;
    update public.wa_conversas cv set atendente_id = new.responsavel_admin_id, departamento_id = coalesce(v_dep, cv.departamento_id), status = 'aguardando_atendente'
      from public.wa_contatos ct
     where ct.id = cv.contato_id and ct.cliente_id = new.id and cv.status not in ('resolvida', 'arquivada');
  elsif new.carteira = 'consultor' and new.consultor_id is distinct from old.consultor_id and new.consultor_id is not null then
    update public.wa_conversas cv set atendente_id = new.consultor_id
      from public.wa_contatos ct
     where ct.id = cv.contato_id and ct.cliente_id = new.id and cv.status not in ('resolvida', 'arquivada');
  end if;
  return new;
end $$;
revoke execute on function public.cliente_reatribuir_conversas() from public, anon, authenticated;
create trigger trg_cliente_conversas after update of carteira, consultor_id on public.clientes for each row execute function public.cliente_reatribuir_conversas();

create or replace function public.desligamento_leads_conversas()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dest uuid;
begin
  if coalesce(current_setting('geeasy.desligamento', true), '') <> 'on' or not (old.ativo and not new.ativo) then return new; end if;
  v_dest := nullif(current_setting('geeasy.desligamento_destino', true), '')::uuid;
  update public.leads set responsavel_id = v_dest where empresa_id = new.empresa_id and responsavel_id = new.user_id and status in ('novo', 'em_contato', 'qualificado');
  update public.wa_conversas set atendente_id = v_dest, status = 'aguardando_atendente' where empresa_id = new.empresa_id and atendente_id = new.user_id and status not in ('resolvida', 'arquivada');
  return new;
end $$;
revoke execute on function public.desligamento_leads_conversas() from public, anon, authenticated;
create trigger trg_desligamento_leads after update of ativo on public.empresa_membros for each row execute function public.desligamento_leads_conversas();

-- o desligamento informa o destinatário para os gatilhos acima
create or replace function public.desligar_membro_destino(p_user uuid, p_destino uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('geeasy.desligamento_destino', coalesce(p_destino::text, ''), true);
  return public.desligar_membro(p_user, p_destino, p_motivo);
end $$;
revoke execute on function public.desligar_membro_destino(uuid, uuid, text) from public, anon;
grant execute on function public.desligar_membro_destino(uuid, uuid, text) to authenticated;

-- tempo real da caixa de entrada
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['wa_conversas', 'wa_mensagens', 'leads'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- fila do WhatsApp (webhooks e envios) a cada minuto junto com o push
select cron.schedule('geeasy-push', '* * * * *', $$select public.disparar_sincronizacao('push,whatsapp')$$);

-- ---------------------------------------------------------------------
-- Formulários públicos de captação (/f/<slug>) e páginas do Facebook/Instagram (Lead Ads)
-- ---------------------------------------------------------------------
create table public.lead_formularios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])$'),
  titulo text not null check (char_length(titulo) between 2 and 160),
  descricao text check (char_length(descricao) <= 1000),
  campanha text check (char_length(campanha) <= 200),
  interesses text[] not null default '{}',
  pedir_documento boolean not null default false,
  pedir_renda boolean not null default false,
  mensagem_sucesso text check (char_length(mensagem_sucesso) <= 500),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.meta_paginas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  page_id text not null unique check (page_id ~ '^\d{5,30}$'),
  nome text not null check (char_length(nome) between 2 and 160),
  campanha_padrao text check (char_length(campanha_padrao) <= 200),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.meta_pagina_tokens (
  pagina_id uuid primary key references public.meta_paginas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  token_enc text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.lead_formularios enable row level security;
alter table public.meta_paginas enable row level security;
alter table public.meta_pagina_tokens enable row level security;
revoke all on public.meta_pagina_tokens from anon, authenticated;
create policy formularios_select on public.lead_formularios for select to authenticated using ((select public.tem_permissao('leads.view')));
create policy formularios_insert on public.lead_formularios for insert to authenticated with check ((select public.tem_permissao('leads.distribuir')));
create policy formularios_update on public.lead_formularios for update to authenticated using ((select public.tem_permissao('leads.distribuir')));
create policy meta_paginas_select on public.meta_paginas for select to authenticated using ((select public.tem_permissao('leads.distribuir')));
create policy meta_paginas_insert on public.meta_paginas for insert to authenticated with check ((select public.tem_permissao('leads.distribuir')));
create policy meta_paginas_update on public.meta_paginas for update to authenticated using ((select public.tem_permissao('leads.distribuir')));
do $$
declare t text;
begin
  foreach t in array array['lead_formularios', 'meta_paginas'] loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger zz_empresa_vinculos before insert or update on public.%1$I for each row execute function public.empresa_vinculos()', t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- Limite por chave anônima (IP com HMAC no servidor) para endpoints públicos; só o servidor chama
create or replace function public.rate_limit_publico(p_chave text, p_max int, p_janela_seg int)
returns boolean language sql security definer set search_path = '' as $$
  select public._rate_limit('pub:' || left(p_chave, 100), greatest(1, least(p_max, 10000)), greatest(1, least(p_janela_seg, 86400)))
$$;
revoke execute on function public.rate_limit_publico(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_publico(text, int, int) to service_role;

-- Parâmetros dos módulos gravados por quem tem a funcionalidade (não só o admin): rotas, leads e WhatsApp
create or replace function public.pode_configurar(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_chave
    when 'rotas' then public.tem_permissao('rotas.definir')
    when 'leads' then public.tem_permissao('leads.distribuir')
    when 'whatsapp' then public.tem_permissao('whatsapp.configurar')
    else false end
$$;
revoke execute on function public.pode_configurar(text) from public, anon;
grant execute on function public.pode_configurar(text) to authenticated;
create policy config_modulo_ins on public.configuracoes for insert to authenticated with check (public.pode_configurar(chave));
create policy config_modulo_upd on public.configuracoes for update to authenticated using (public.pode_configurar(chave)) with check (public.pode_configurar(chave));

-- Abrir conversa a partir da ficha do cliente (atendente = quem abriu; fora da janela de 24 h só modelo)
create or replace function public.wa_abrir_conversa_cliente(p_cliente uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); c record; v_tel text; v_num uuid; v_ct uuid; v_cv uuid;
begin
  if not public.tem_permissao('whatsapp.atender') or not public.can_access_cliente(p_cliente) then raise exception 'Sem acesso ao cliente.' using errcode = '42501'; end if;
  select id, nome, whatsapp, telefone into c from public.clientes where id = p_cliente and empresa_id = v_emp and excluido_em is null;
  if not found then raise exception 'Cliente não encontrado.'; end if;
  v_tel := coalesce(public.telefone_e164(c.whatsapp), public.telefone_e164(c.telefone));
  if v_tel is null then raise exception 'O cliente não tem WhatsApp/telefone válido.'; end if;
  select id into v_num from public.wa_numeros where empresa_id = v_emp and ativo order by created_at limit 1;
  if v_num is null then raise exception 'Nenhum número de WhatsApp conectado.'; end if;
  insert into public.wa_contatos (empresa_id, telefone, nome, cliente_id) values (v_emp, v_tel, c.nome, p_cliente)
  on conflict (empresa_id, telefone) do update set cliente_id = coalesce(public.wa_contatos.cliente_id, excluded.cliente_id)
  returning id into v_ct;
  select id into v_cv from public.wa_conversas where empresa_id = v_emp and contato_id = v_ct and numero_id = v_num and status not in ('resolvida', 'arquivada');
  if v_cv is null then
    insert into public.wa_conversas (empresa_id, contato_id, numero_id, status, atendente_id)
    values (v_emp, v_ct, v_num, 'aguardando_cliente', auth.uid()) returning id into v_cv;
  end if;
  return v_cv;
end $$;
revoke execute on function public.wa_abrir_conversa_cliente(uuid) from public, anon;
grant execute on function public.wa_abrir_conversa_cliente(uuid) to authenticated;
