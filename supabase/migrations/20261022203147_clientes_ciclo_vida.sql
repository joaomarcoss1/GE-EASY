-- =====================================================================
-- GE EASY — Fase 3: base de clientes, carteiras, documentação e regra dos 45 dias
--
-- * clientes: carteira (consultor | administrativo | juridico), status do cadastro (máquina de estados),
--   prazo de documentação, consentimento LGPD e histórico de carteira;
-- * documentos exigidos por empresa e análise documental (enviado → em análise → aprovado/recusado/vencido);
-- * rotina diária: avisos D-15/7/3/1 e transferência automática para a base administrativa
--   (padrões configuráveis em configuracoes 'documentacao');
-- * prorrogação, redistribuição/devolução, checagem de duplicidade sem expor outra carteira;
-- * encaminhamento ao jurídico (processo nasce do cliente com situação de encaminhamento).
-- =====================================================================

create type public.cliente_carteira as enum ('consultor', 'administrativo', 'juridico');
create type public.cadastro_status as enum ('pre_cadastro', 'pendente_documentacao', 'documentacao_completa', 'transferido_administrativo', 'ativo', 'perdido', 'inativo');
create type public.documento_analise as enum ('enviado', 'em_analise', 'aprovado', 'recusado', 'vencido');

alter table public.clientes
  add column if not exists carteira public.cliente_carteira not null default 'consultor',
  add column if not exists status_cadastro public.cadastro_status not null default 'pre_cadastro',
  add column if not exists pendente_desde timestamptz,
  add column if not exists prazo_documentacao timestamptz,
  add column if not exists prorrogacoes int not null default 0,
  add column if not exists transferido_em timestamptz,
  add column if not exists consultor_original_id uuid references public.profiles(id) on delete set null,
  add column if not exists responsavel_admin_id uuid references public.profiles(id) on delete set null,
  add column if not exists motivo_perda text,
  add column if not exists latitude double precision check (latitude between -90 and 90),
  add column if not exists longitude double precision check (longitude between -180 and 180),
  add column if not exists lgpd_consentimento_em timestamptz,
  add column if not exists lgpd_termo_versao text,
  add column if not exists lgpd_consentimento_origem jsonb;

-- dados atuais: sem disparar prazos para clientes antigos
alter table public.clientes disable trigger user;
update public.clientes set
  carteira = case when consultor_id is null then 'administrativo' else 'consultor' end::public.cliente_carteira,
  status_cadastro = case status when 'ativo' then 'ativo' when 'inativo' then 'inativo' else 'pre_cadastro' end::public.cadastro_status;
alter table public.clientes enable trigger user;

create index on public.clientes (empresa_id, status_cadastro, prazo_documentacao) where status_cadastro = 'pendente_documentacao';
create index on public.clientes (empresa_id, carteira, status_cadastro);
create index on public.clientes (empresa_id, consultor_id);
create index clientes_documento_busca on public.clientes (empresa_id, documento);

drop trigger if exists zz_empresa_vinculos on public.clientes;
create trigger zz_empresa_vinculos before insert or update on public.clientes
  for each row execute function public.empresa_vinculos('consultor_id:@', 'responsavel_admin_id:@', 'consultor_original_id:@');

-- ---------------------------------------------------------------------
-- Parâmetros (por empresa) e prazo
-- ---------------------------------------------------------------------
create or replace function public.parametros_documentacao(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('prazo_dias', 45, 'contagem', 'corridos', 'avisos', jsonb_build_array(15, 7, 3, 1),
                            'max_prorrogacoes', 2, 'prorrogacao_dias', 15, 'comissao_apos_transferencia', false)
         || coalesce((select c.valor from public.configuracoes c where c.empresa_id = p_empresa and c.chave = 'documentacao'), '{}'::jsonb)
$$;
revoke execute on function public.parametros_documentacao(uuid) from public, anon, authenticated;

-- shortcut: dias úteis = segunda a sexta, sem feriados; usar o calendário de feriados quando o módulo existir
create or replace function public.somar_prazo(p_inicio timestamptz, p_dias int, p_contagem text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v timestamptz := p_inicio; n int := 0;
begin
  if p_contagem <> 'uteis' then return p_inicio + make_interval(days => p_dias); end if;
  while n < p_dias loop
    v := v + interval '1 day';
    if extract(isodow from v) < 6 then n := n + 1; end if;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Máquina de estados do cadastro
-- ---------------------------------------------------------------------
create or replace function public.cliente_ciclo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cfg jsonb;
  v_de public.cadastro_status := case when tg_op = 'UPDATE' then old.status_cadastro end;
  v_para public.cadastro_status := new.status_cadastro;
  v_usuario boolean := auth.uid() is not null;
  v_rotina boolean := coalesce(current_setting('geeasy.rotina_documentacao', true), '') = 'on';
begin
  -- carteira: sem consultor dono => base administrativa
  if tg_op = 'INSERT' and new.consultor_id is null and new.carteira = 'consultor' then
    new.carteira := 'administrativo';
  end if;
  if tg_op = 'INSERT' and v_usuario and not v_rotina and v_para not in ('pre_cadastro', 'pendente_documentacao')
     and not (public.tem_permissao('documentacao.analisar') or public.is_manager()) then
    raise exception 'Cadastro novo começa como pré-cadastro ou documentação pendente.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and v_de is distinct from v_para then
    if not (
         (v_de = 'pre_cadastro' and v_para in ('pendente_documentacao', 'perdido', 'inativo'))
      or (v_de = 'pendente_documentacao' and v_para in ('documentacao_completa', 'transferido_administrativo', 'perdido', 'pre_cadastro'))
      or (v_de = 'transferido_administrativo' and v_para in ('documentacao_completa', 'pendente_documentacao', 'perdido'))
      or (v_de = 'documentacao_completa' and v_para in ('ativo', 'pendente_documentacao', 'perdido'))
      or (v_de = 'ativo' and v_para in ('inativo', 'documentacao_completa'))
      or (v_de in ('perdido', 'inativo') and v_para in ('pre_cadastro', 'ativo'))
    ) then
      raise exception 'Mudança de situação do cadastro não permitida (% → %).', v_de, v_para using errcode = '23514';
    end if;
    if v_usuario and not v_rotina then
      if v_para = 'transferido_administrativo' and not public.tem_permissao('clientes.transfer') then
        raise exception 'A transferência para a base administrativa é feita pela rotina ou pela gestão.' using errcode = '42501';
      end if;
      if v_para in ('documentacao_completa', 'ativo') and not (public.tem_permissao('documentacao.analisar') or public.is_manager()) then
        raise exception 'Somente a análise documental conclui o cadastro.' using errcode = '42501';
      end if;
      if v_de in ('perdido', 'inativo') and v_para = 'ativo' and not public.is_manager() then
        raise exception 'Somente a gestão reativa um cliente.' using errcode = '42501';
      end if;
    end if;
    if v_para = 'perdido' and coalesce(trim(new.motivo_perda), '') = '' then
      raise exception 'Informe o motivo da perda.' using errcode = '23514';
    end if;
  end if;

  -- entrada em "pendente documentação" na carteira de um consultor => abre o prazo
  if v_para = 'pendente_documentacao' and (tg_op = 'INSERT' or v_de is distinct from v_para or old.carteira is distinct from new.carteira
                                            or old.consultor_id is distinct from new.consultor_id) then
    if new.carteira = 'consultor' and new.consultor_id is not null then
      v_cfg := public.parametros_documentacao(new.empresa_id);
      new.pendente_desde := now();
      new.prazo_documentacao := public.somar_prazo(now(), greatest(1, (v_cfg->>'prazo_dias')::int), v_cfg->>'contagem');
      new.prorrogacoes := 0;
    else
      new.pendente_desde := coalesce(new.pendente_desde, now());
      new.prazo_documentacao := null;
    end if;
  elsif v_para <> 'pendente_documentacao' then
    new.prazo_documentacao := null;
    if v_para in ('documentacao_completa', 'ativo') then new.pendente_desde := null; end if;
  end if;

  -- situação comercial acompanha o cadastro
  if v_para = 'ativo' then new.status := 'ativo';
  elsif v_para in ('inativo', 'perdido') then new.status := 'inativo';
  end if;
  return new;
end $$;
revoke execute on function public.cliente_ciclo() from public, anon, authenticated;
-- nome "zciclo": roda depois de trg_clientes_own (que define o consultor) e antes de zz_empresa_vinculos
create trigger trg_clientes_zciclo before insert or update on public.clientes for each row execute function public.cliente_ciclo();

-- Consultores só atribuem a si; a equipe administrativa cadastra na base administrativa; redistribuir exige permissão
create or replace function public.enforce_own_consultor()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if tg_table_name = 'clientes' and public.current_app_role() = 'administrativo' then
      if not public.tem_permissao('clientes.transfer') then new.consultor_id := null; end if;
    else
      new.consultor_id := auth.uid();
    end if;
  elsif new.consultor_id is distinct from old.consultor_id
        and not (tg_table_name = 'clientes' and (public.tem_permissao('clientes.transfer') or coalesce(current_setting('geeasy.rotina_documentacao', true), '') = 'on')) then
    raise exception 'Somente a gestão pode transferir a carteira' using errcode = '42501';
  end if;
  -- IF aninhado: NEW.carteira só existe em clientes (o gatilho também roda em oportunidades, cotas e apólices)
  if tg_table_name = 'clientes' and tg_op = 'UPDATE' then
    if new.carteira is distinct from old.carteira
       and not (public.tem_permissao('clientes.transfer') or coalesce(current_setting('geeasy.rotina_documentacao', true), '') = 'on') then
      raise exception 'Somente a gestão pode mudar a carteira do cliente' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Histórico de carteira (gravado automaticamente)
-- ---------------------------------------------------------------------
create table public.cliente_carteira_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  de_carteira public.cliente_carteira,
  para_carteira public.cliente_carteira,
  de_usuario uuid references public.profiles(id) on delete set null,
  para_usuario uuid references public.profiles(id) on delete set null,
  motivo text not null check (motivo in ('criacao', 'manual', 'regra_prazo_documentacao', 'desligamento', 'redistribuicao', 'devolucao', 'prorrogacao')),
  observacao text check (char_length(observacao) <= 1000),
  executado_por uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.cliente_carteira_historico (empresa_id, cliente_id, created_at desc);
create index on public.cliente_carteira_historico (empresa_id, de_usuario, created_at desc);
create trigger zz_empresa_vinculos before insert or update on public.cliente_carteira_historico
  for each row execute function public.empresa_vinculos('cliente_id:clientes');

create or replace function public.cliente_historico_carteira()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.carteira is distinct from old.carteira or new.consultor_id is distinct from old.consultor_id then
    insert into public.cliente_carteira_historico (empresa_id, cliente_id, de_carteira, para_carteira, de_usuario, para_usuario, motivo, observacao, executado_por)
    values (new.empresa_id, new.id,
            case when tg_op = 'UPDATE' then old.carteira end, new.carteira,
            case when tg_op = 'UPDATE' then old.consultor_id end, new.consultor_id,
            case when tg_op = 'INSERT' then 'criacao' else coalesce(nullif(current_setting('geeasy.motivo_carteira', true), ''), 'manual') end,
            nullif(current_setting('geeasy.obs_carteira', true), ''), auth.uid());
  end if;
  return new;
end $$;
revoke execute on function public.cliente_historico_carteira() from public, anon, authenticated;
create trigger trg_cliente_historico_carteira after insert or update of carteira, consultor_id on public.clientes
  for each row execute function public.cliente_historico_carteira();

-- ---------------------------------------------------------------------
-- Acesso a clientes: consultor só na própria carteira (perde acesso após transferência);
-- base completa para quem tem clientes.ver_todos; responsável administrativo
-- ---------------------------------------------------------------------
create or replace function public.can_access_cliente(p_cliente uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clientes c
     where c.id = p_cliente and c.empresa_id = public.empresa_atual() and c.excluido_em is null
       and (public.is_backoffice() or public.is_juridico() or public.tem_permissao('clientes.ver_todos')
            or c.responsavel_admin_id = auth.uid()
            or (c.carteira = 'consultor' and c.consultor_id = auth.uid()))
  )
$$;

alter policy clientes_select on public.clientes
  using (public.is_backoffice() or public.is_juridico() or (select public.tem_permissao('clientes.ver_todos'))
         or responsavel_admin_id = auth.uid() or (carteira = 'consultor' and consultor_id = auth.uid()));
alter policy clientes_update on public.clientes
  using (public.is_manager() or (select public.tem_permissao('clientes.ver_todos')) or responsavel_admin_id = auth.uid()
         or (public.is_active_user() and carteira = 'consultor' and consultor_id = auth.uid()))
  with check (public.is_manager() or (select public.tem_permissao('clientes.ver_todos')) or responsavel_admin_id = auth.uid()
         or (public.is_active_user() and carteira = 'consultor' and consultor_id = auth.uid()));

alter table public.cliente_carteira_historico enable row level security;
create policy carteira_hist_select on public.cliente_carteira_historico for select to authenticated
  using (public.is_manager() or (select public.tem_permissao('clientes.ver_todos')) or de_usuario = auth.uid() or para_usuario = auth.uid());
create policy cliente_carteira_historico_empresa on public.cliente_carteira_historico as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
revoke all on public.cliente_carteira_historico from anon;

-- ---------------------------------------------------------------------
-- Documentos exigidos e análise documental
-- ---------------------------------------------------------------------
create table public.documento_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  categoria text not null check (char_length(categoria) between 2 and 60),
  nome text not null check (char_length(nome) between 2 and 120),
  obrigatorio boolean not null default true,
  aplica_pf boolean not null default true,
  aplica_pj boolean not null default true,
  validade_dias int check (validade_dias is null or validade_dias between 1 and 3650),
  ativo boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, categoria)
);
create trigger trg_documento_tipos_updated before update on public.documento_tipos for each row execute function public.set_updated_at();
create trigger zz_empresa_vinculos before insert or update on public.documento_tipos for each row execute function public.empresa_vinculos();

alter table public.documentos
  add column if not exists analise_status public.documento_analise not null default 'enviado',
  add column if not exists analise_motivo text check (char_length(analise_motivo) <= 1000),
  add column if not exists analisado_por uuid references public.profiles(id) on delete set null,
  add column if not exists analisado_em timestamptz,
  add column if not exists validade date;
create index on public.documentos (empresa_id, analise_status, created_at) where analise_status in ('enviado', 'em_analise');
-- documentos já existentes não entram na fila de análise
alter table public.documentos disable trigger user;
update public.documentos set analise_status = 'aprovado';
alter table public.documentos enable trigger user;

-- Campos da análise só mudam pela função analisar_documento (definer)
create or replace function public.documentos_integridade()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_servidor boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
  v_rel text;
begin
  if tg_op = 'INSERT' then
    if new.processo_id is not null then new.cliente_id := null; end if;
    if new.storage_path is not null then
      v_rel := case
        when new.storage_path like 'empresas/' || new.empresa_id::text || '/%' then substr(new.storage_path, length('empresas/' || new.empresa_id::text || '/') + 1)
        when new.storage_path like 'empresas/%' then null
        else new.storage_path end;
      if v_rel is null or not (
           (new.processo_id is not null and v_rel like 'processos/' || new.processo_id::text || '/%')
        or (new.processo_id is null and new.cliente_id is not null and v_rel like 'clientes/' || new.cliente_id::text || '/%')
      ) then
        raise exception 'Caminho do arquivo incompatível com o cliente/processo do documento.' using errcode = '42501';
      end if;
    end if;
    if not v_servidor then
      new.drive_file_id := null; new.drive_url := null; new.drive_status := 'pendente';
      new.drive_erro := null; new.drive_tentativas := 0; new.drive_sincronizado_em := null; new.drive_bloqueado_ate := null;
      new.analise_status := 'enviado'; new.analise_motivo := null; new.analisado_por := null; new.analisado_em := null;
    end if;
  elsif not v_servidor then
    new.storage_path := old.storage_path; new.cliente_id := old.cliente_id; new.processo_id := old.processo_id;
    new.mime_type := old.mime_type; new.tamanho := old.tamanho; new.enviado_por := old.enviado_por;
    new.drive_file_id := old.drive_file_id; new.drive_url := old.drive_url; new.drive_status := old.drive_status;
    new.drive_erro := old.drive_erro; new.drive_tentativas := old.drive_tentativas;
    new.drive_sincronizado_em := old.drive_sincronizado_em; new.drive_bloqueado_ate := old.drive_bloqueado_ate;
    new.analise_status := old.analise_status; new.analise_motivo := old.analise_motivo;
    new.analisado_por := old.analisado_por; new.analisado_em := old.analisado_em; new.validade := old.validade;
  end if;
  return new;
end $$;

-- Situação documental do cliente: exigidos, aprovados válidos e faltantes
create or replace function public.situacao_documental(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cli record; v jsonb;
begin
  select c.id, c.empresa_id, c.tipo_pessoa into v_cli from public.clientes c where c.id = p_cliente;
  if not found or (auth.uid() is not null and not public.can_access_cliente(p_cliente)) then return null; end if;
  select jsonb_build_object(
    'exigidos', coalesce(jsonb_agg(jsonb_build_object('categoria', t.categoria, 'nome', t.nome, 'obrigatorio', t.obrigatorio,
                  'situacao', coalesce(d.situacao, 'faltando')) order by t.ordem, t.nome), '[]'::jsonb),
    'faltando', coalesce(jsonb_agg(t.nome order by t.ordem, t.nome) filter (where t.obrigatorio and coalesce(d.situacao, 'faltando') <> 'aprovado'), '[]'::jsonb),
    'completo', bool_and(not t.obrigatorio or coalesce(d.situacao, '') = 'aprovado') is not false)
    into v
    from public.documento_tipos t
    left join lateral (
      select case
               when bool_or(x.analise_status = 'aprovado' and (x.validade is null or x.validade >= current_date)) then 'aprovado'
               when bool_or(x.analise_status in ('enviado', 'em_analise')) then 'em_analise'
               when bool_or(x.analise_status = 'recusado') then 'recusado'
               when bool_or(x.analise_status = 'vencido' or x.validade < current_date) then 'vencido'
             end as situacao
        from public.documentos x
       where x.cliente_id = v_cli.id and x.categoria = t.categoria and x.excluido_em is null
    ) d on true
   where t.empresa_id = v_cli.empresa_id and t.ativo
     and ((v_cli.tipo_pessoa = 'PF' and t.aplica_pf) or (v_cli.tipo_pessoa = 'PJ' and t.aplica_pj));
  return v;
end $$;

-- Ao aprovar o último documento obrigatório, o cadastro fica completo (e sai do prazo)
create or replace function public.documento_atualiza_cliente()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sit jsonb;
begin
  if new.cliente_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.analise_status is not distinct from old.analise_status and new.excluido_em is not distinct from old.excluido_em then
    return new;
  end if;
  v_sit := public.situacao_documental(new.cliente_id);
  if coalesce((v_sit->>'completo')::boolean, false) then
    perform set_config('geeasy.rotina_documentacao', 'on', true);
    update public.clientes set status_cadastro = 'documentacao_completa'
     where id = new.cliente_id and status_cadastro in ('pendente_documentacao', 'transferido_administrativo');
    perform set_config('geeasy.rotina_documentacao', 'off', true);
  end if;
  return new;
end $$;
revoke execute on function public.documento_atualiza_cliente() from public, anon, authenticated;
create trigger trg_documento_atualiza_cliente after insert or update on public.documentos
  for each row execute function public.documento_atualiza_cliente();

create or replace function public.analisar_documento(p_documento uuid, p_status public.documento_analise, p_motivo text default null, p_validade date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc record; v_validade_dias int;
begin
  if not public.tem_permissao('documentacao.analisar') then raise exception 'Sem permissão para analisar documentos.' using errcode = '42501'; end if;
  if p_status not in ('em_analise', 'aprovado', 'recusado') then raise exception 'Situação inválida.'; end if;
  if p_status = 'recusado' and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  select d.id, d.cliente_id, d.nome, d.enviado_por, d.empresa_id, d.categoria into v_doc from public.documentos d
   where d.id = p_documento and d.empresa_id = public.empresa_atual() and d.excluido_em is null;
  if not found or v_doc.cliente_id is null or not public.can_access_cliente(v_doc.cliente_id) then raise exception 'Documento não encontrado.'; end if;
  select t.validade_dias into v_validade_dias from public.documento_tipos t where t.empresa_id = v_doc.empresa_id and t.categoria = v_doc.categoria;
  update public.documentos set analise_status = p_status, analise_motivo = nullif(trim(p_motivo), ''), analisado_por = auth.uid(), analisado_em = now(),
         validade = coalesce(p_validade, case when p_status = 'aprovado' and v_validade_dias is not null then current_date + v_validade_dias end, validade)
   where id = p_documento;
  if p_status = 'recusado' and v_doc.enviado_por is not null and v_doc.enviado_por <> auth.uid() then
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    values (v_doc.empresa_id, v_doc.enviado_por, 'Documento recusado', left(v_doc.nome || ': ' || p_motivo, 300), '/clientes/' || v_doc.cliente_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Prorrogação, redistribuição/devolução e duplicidade
-- ---------------------------------------------------------------------
create or replace function public.prorrogar_documentacao(p_cliente uuid, p_dias int, p_motivo text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare v_cli record; v_cfg jsonb; v_novo timestamptz;
begin
  if not public.tem_permissao('documentacao.prorrogar') then raise exception 'Sem permissão para prorrogar.' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' or char_length(p_motivo) > 500 then raise exception 'Informe o motivo da prorrogação.'; end if;
  select * into v_cli from public.clientes where id = p_cliente and empresa_id = public.empresa_atual() and excluido_em is null for update;
  if not found or v_cli.status_cadastro <> 'pendente_documentacao' or v_cli.prazo_documentacao is null then
    raise exception 'O cliente não está com documentação pendente na carteira de um consultor.';
  end if;
  v_cfg := public.parametros_documentacao(v_cli.empresa_id);
  if v_cli.prorrogacoes >= (v_cfg->>'max_prorrogacoes')::int then
    raise exception 'Limite de prorrogações atingido (%).', v_cfg->>'max_prorrogacoes';
  end if;
  v_novo := public.somar_prazo(greatest(v_cli.prazo_documentacao, now()), least(greatest(coalesce(p_dias, (v_cfg->>'prorrogacao_dias')::int), 1), 90), v_cfg->>'contagem');
  update public.clientes set prazo_documentacao = v_novo, prorrogacoes = prorrogacoes + 1 where id = p_cliente;
  insert into public.cliente_carteira_historico (empresa_id, cliente_id, de_carteira, para_carteira, de_usuario, para_usuario, motivo, observacao)
  values (v_cli.empresa_id, p_cliente, v_cli.carteira, v_cli.carteira, v_cli.consultor_id, v_cli.consultor_id, 'prorrogacao',
          'Prazo até ' || to_char(v_novo at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ' — ' || p_motivo);
  return v_novo;
end $$;

-- Redistribui (para consultor ou base administrativa). Para consultor com documentação pendente, abre novo prazo.
create or replace function public.redistribuir_clientes(p_clientes uuid[], p_consultor uuid, p_motivo text, p_devolucao boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_id uuid; n int := 0; v_cli record; v_sit jsonb;
begin
  if not public.tem_permissao('clientes.transfer') then raise exception 'Sem permissão para redistribuir.' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  if array_length(p_clientes, 1) > 500 then raise exception 'Máximo de 500 clientes por vez.'; end if;
  if p_consultor is not null and not exists (
    select 1 from public.empresa_membros m where m.empresa_id = v_emp and m.user_id = p_consultor and m.ativo) then
    raise exception 'Consultor não pertence à empresa.';
  end if;
  perform set_config('geeasy.motivo_carteira', case when p_devolucao then 'devolucao' else 'redistribuicao' end, true);
  perform set_config('geeasy.obs_carteira', left(p_motivo, 1000), true);
  perform set_config('geeasy.rotina_documentacao', 'on', true);
  foreach v_id in array p_clientes loop
    select * into v_cli from public.clientes where id = v_id and empresa_id = v_emp and excluido_em is null for update;
    continue when not found;
    if p_consultor is null then
      update public.clientes set carteira = 'administrativo', consultor_id = null where id = v_id;
    else
      v_sit := public.situacao_documental(v_id);
      update public.clientes set carteira = 'consultor', consultor_id = p_consultor, responsavel_admin_id = null,
             status_cadastro = case when status_cadastro = 'transferido_administrativo' then
                                      (case when coalesce((v_sit->>'completo')::boolean, false) then 'documentacao_completa' else 'pendente_documentacao' end)::public.cadastro_status
                                    else status_cadastro end
       where id = v_id; -- novo consultor com documentação pendente => novo prazo (gatilho cliente_ciclo)
      insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
      values (v_emp, p_consultor, 'Cliente atribuído a você', left(v_cli.nome || ' — ' || p_motivo, 300), '/clientes/' || v_id);
    end if;
    n := n + 1;
  end loop;
  perform set_config('geeasy.rotina_documentacao', 'off', true);
  perform set_config('geeasy.motivo_carteira', '', true);
  perform set_config('geeasy.obs_carteira', '', true);
  return n;
end $$;

-- Duplicidade por CPF/CNPJ: informa a carteira sem expor dados de outra carteira
create or replace function public.verificar_documento_cliente(p_documento text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'); v_cli record;
begin
  if not public.is_active_user() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  if length(v_doc) not in (11, 14) then return jsonb_build_object('existe', false); end if;
  if not public._rate_limit('dup:' || auth.uid(), 120, 3600) then raise exception 'Muitas consultas. Aguarde alguns minutos.'; end if;
  select c.id, c.carteira, c.excluido_em is not null as na_lixeira into v_cli
    from public.clientes c where c.empresa_id = public.empresa_atual() and c.documento = v_doc limit 1;
  if not found then return jsonb_build_object('existe', false); end if;
  if public.can_access_cliente(v_cli.id) then
    return jsonb_build_object('existe', true, 'acessivel', true, 'cliente_id', v_cli.id, 'carteira', v_cli.carteira);
  end if;
  return jsonb_build_object('existe', true, 'acessivel', false, 'carteira', v_cli.carteira, 'na_lixeira', v_cli.na_lixeira);
end $$;

-- Pede à gestão a transferência de um cliente que já existe em outra carteira
create or replace function public.solicitar_transferencia_cliente(p_documento text, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_doc text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'); v_cli uuid; v_emp uuid := public.empresa_atual();
begin
  if not public.is_active_user() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  if not public._rate_limit('transf:' || auth.uid(), 20, 86400) then raise exception 'Limite de solicitações atingido hoje.'; end if;
  select id into v_cli from public.clientes where empresa_id = v_emp and documento = v_doc and excluido_em is null;
  if v_cli is null then raise exception 'Cliente não encontrado.'; end if;
  insert into public.tarefas (empresa_id, titulo, descricao, prioridade, cliente_id, responsavel_id, created_by)
  select v_emp, 'Solicitação de transferência de cliente',
         left((select full_name from public.profiles where id = auth.uid()) || ' pediu a transferência do cliente (documento final ' || right(v_doc, 4) || '): ' || p_motivo, 2000),
         'media', v_cli, m.user_id, auth.uid()
    from public.empresa_membros m where m.empresa_id = v_emp and m.ativo and (m.admin_master or m.role = 'gestor')
   order by m.admin_master desc limit 1;
end $$;

-- Histórico visível ao consultor: clientes que saíram da carteira dele (só o nome, sem dados pessoais)
create or replace function public.meus_clientes_transferidos(p_limite int default 50)
returns table (cliente_nome text, motivo text, transferido_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.nome, h.motivo, h.created_at
    from public.cliente_carteira_historico h join public.clientes c on c.id = h.cliente_id
   where h.empresa_id = public.empresa_atual() and h.de_usuario = auth.uid() and h.para_usuario is distinct from auth.uid()
     and h.motivo in ('regra_prazo_documentacao', 'redistribuicao', 'desligamento')
   order by h.created_at desc limit least(greatest(p_limite, 1), 200)
$$;

-- ---------------------------------------------------------------------
-- Rotina diária: avisos e transferência automática (idempotente)
-- ---------------------------------------------------------------------
create or replace function public.processar_prazos_documentacao()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record; c record; v_cfg jsonb; v_dep uuid; v_avisos int := 0; v_transf int := 0; v_vencidos int := 0; k int; v_sit jsonb;
begin
  perform set_config('geeasy.rotina_documentacao', 'on', true);
  perform set_config('geeasy.motivo_carteira', 'regra_prazo_documentacao', true);
  for e in select id, fuso from public.empresas where status in ('trial', 'ativa') loop
    v_cfg := public.parametros_documentacao(e.id);

    -- documentos vencidos
    update public.documentos set analise_status = 'vencido'
     where empresa_id = e.id and analise_status = 'aprovado' and validade < (now() at time zone e.fuso)::date;
    get diagnostics k = row_count; v_vencidos := v_vencidos + k;

    -- avisos D-N ao consultor e à supervisão do departamento comercial dele
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
    select e.id, u.user_id, 'Documentação pendente: faltam ' || x.dias || ' dia(s)',
           left(x.nome || ' — falta: ' || coalesce((select string_agg(f, ', ') from jsonb_array_elements_text(public.situacao_documental(x.id)->'faltando') f), 'conferir documentos'), 300),
           '/clientes/' || x.id, 'doc-prazo:' || x.id || ':' || x.dias
      from (select cl.id, cl.nome, cl.consultor_id,
                   ((cl.prazo_documentacao at time zone e.fuso)::date - (now() at time zone e.fuso)::date) as dias
              from public.clientes cl
             where cl.empresa_id = e.id and cl.status_cadastro = 'pendente_documentacao' and cl.carteira = 'consultor'
               and cl.excluido_em is null and cl.prazo_documentacao > now()) x
      cross join lateral (
        select x.consultor_id as user_id
        union
        select dm2.user_id from public.departamento_membros dm
          join public.departamentos d on d.id = dm.departamento_id and d.tipo = 'consultor'
          join public.departamento_membros dm2 on dm2.departamento_id = d.id and dm2.ativo
          join public.departamento_niveis n on n.id = dm2.nivel_id and n.ordem >= 2
         where dm.user_id = x.consultor_id
      ) u
     where x.dias in (select (a)::int from jsonb_array_elements_text(v_cfg->'avisos') a) and u.user_id is not null
    on conflict (user_id, chave) where chave is not null do nothing;
    get diagnostics k = row_count; v_avisos := v_avisos + k;

    -- transferência para a base administrativa
    select d.id into v_dep from public.departamentos d where d.empresa_id = e.id and d.tipo = 'administrativo' and d.ativo order by d.created_at limit 1;
    for c in select cl.id, cl.nome, cl.consultor_id from public.clientes cl
              where cl.empresa_id = e.id and cl.status_cadastro = 'pendente_documentacao' and cl.carteira = 'consultor'
                and cl.excluido_em is null and cl.prazo_documentacao <= now()
              for update skip locked loop
      v_sit := public.situacao_documental(c.id);
      continue when coalesce((v_sit->>'completo')::boolean, false); -- completou no limite: o gatilho do documento conclui
      update public.clientes set carteira = 'administrativo', consultor_original_id = consultor_id, consultor_id = null,
             status_cadastro = 'transferido_administrativo', transferido_em = now()
       where id = c.id;
      insert into public.tarefas (empresa_id, titulo, descricao, prioridade, cliente_id, departamento_id, vencimento)
      values (e.id, left('Concluir documentação: ' || c.nome, 200),
              'Transferido da carteira do consultor por falta de documentação. Falta: ' || coalesce((select string_agg(f, ', ') from jsonb_array_elements_text(v_sit->'faltando') f), '-'),
              'alta', c.id, v_dep, (now() at time zone e.fuso)::date + 7);
      insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
      select e.id, u, case when u = c.consultor_id then 'Cliente transferido para o administrativo' else 'Cliente transferido para a base administrativa' end,
             left(c.nome || ': prazo de documentação esgotado', 300),
             case when u = c.consultor_id then '/consultor' else '/clientes/' || c.id end, 'doc-transf:' || c.id || ':' || u
        from (
          select c.consultor_id as u
          union select m.user_id from public.empresa_membros m where m.empresa_id = e.id and m.ativo and m.role = 'gestor'
          union select dm.user_id from public.departamento_membros dm where dm.departamento_id = v_dep and dm.ativo
        ) dest where u is not null
      on conflict (user_id, chave) where chave is not null do nothing;
      v_transf := v_transf + 1;
    end loop;
  end loop;
  perform set_config('geeasy.rotina_documentacao', 'off', true);
  perform set_config('geeasy.motivo_carteira', '', true);
  return jsonb_build_object('avisos', v_avisos, 'transferidos', v_transf, 'documentos_vencidos', v_vencidos);
end $$;
revoke execute on function public.processar_prazos_documentacao() from public, anon, authenticated;
select cron.schedule('geeasy-prazo-documentacao', '5 3 * * *', $$select public.processar_prazos_documentacao()$$);

-- ---------------------------------------------------------------------
-- Encaminhamento ao jurídico
-- ---------------------------------------------------------------------
alter table public.processos
  add column if not exists situacao_encaminhamento text check (situacao_encaminhamento in ('encaminhado', 'em_analise', 'ajuizado', 'cancelado', 'pendente_confirmacao')),
  add column if not exists encaminhado_por uuid references public.profiles(id) on delete set null,
  add column if not exists encaminhado_em timestamptz;
create index on public.processos (empresa_id, situacao_encaminhamento, encaminhado_em) where situacao_encaminhamento is not null;

create or replace function public.encaminhar_ao_juridico(p_cliente uuid, p_titulo text, p_area public.processo_area, p_observacoes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_dep uuid; v_id uuid; v_nome text;
begin
  if not public.tem_permissao('juridico.encaminhar') then raise exception 'Sem permissão para encaminhar ao jurídico.' using errcode = '42501'; end if;
  if not public.can_access_cliente(p_cliente) then raise exception 'Cliente não encontrado.'; end if;
  if char_length(coalesce(trim(p_titulo), '')) < 2 then raise exception 'Informe o assunto.'; end if;
  select nome into v_nome from public.clientes where id = p_cliente;
  select d.id into v_dep from public.departamentos d where d.empresa_id = v_emp and d.tipo = 'juridico' and d.ativo order by d.created_at, d.nome limit 1;
  insert into public.processos (empresa_id, titulo, cliente_id, area, departamento_id, responsavel_id, observacoes, fase, status,
                                situacao_encaminhamento, encaminhado_por, encaminhado_em, created_by)
  values (v_emp, left(trim(p_titulo), 250), p_cliente, coalesce(p_area, 'civel'), v_dep, null, left(p_observacoes, 5000), 'pre_processual', 'ativo',
          'encaminhado', auth.uid(), now(), auth.uid())
  returning id into v_id;
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  select distinct v_emp, x.u, 'Novo encaminhamento ao jurídico', left(v_nome || ' — ' || p_titulo, 300), '/processos/' || v_id
    from (select dm.user_id as u from public.departamento_membros dm where dm.departamento_id = v_dep and dm.ativo
          union select d.responsavel_id from public.departamentos d where d.id = v_dep) x
   where x.u is not null and x.u <> auth.uid();
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- RLS e padrões das empresas
-- ---------------------------------------------------------------------
alter table public.documento_tipos enable row level security;
create policy documento_tipos_select on public.documento_tipos for select to authenticated using (public.is_active_user());
create policy documento_tipos_write on public.documento_tipos for all to authenticated
  using ((select public.tem_permissao('cadastros.manage'))) with check ((select public.tem_permissao('cadastros.manage')));
create policy documento_tipos_empresa on public.documento_tipos as restrictive for all to authenticated
  using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()));
revoke all on public.documento_tipos from anon;
create trigger trg_audit_documento_tipos after insert or update or delete on public.documento_tipos for each row execute function public.audit_trigger();
create trigger trg_audit_cliente_carteira_historico after insert on public.cliente_carteira_historico for each row execute function public.audit_trigger();

-- documentos: quem analisa enxerga os documentos de qualquer cliente que acessa (já coberto por can_access_cliente)

create or replace function public.documento_tipos_padrao(p_empresa uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.documento_tipos (empresa_id, categoria, nome, obrigatorio, aplica_pf, aplica_pj, validade_dias, ordem) values
    (p_empresa, 'rg_cnh', 'RG ou CNH', true, true, false, null, 1),
    (p_empresa, 'cpf_cnpj', 'CPF / Cartão CNPJ', true, true, true, null, 2),
    (p_empresa, 'comprovante_residencia', 'Comprovante de residência (até 90 dias)', true, true, true, 90, 3),
    (p_empresa, 'comprovante_renda', 'Comprovante de renda', false, true, false, null, 4),
    (p_empresa, 'contrato', 'Contrato social / documento de constituição', true, false, true, null, 5)
  on conflict (empresa_id, categoria) do nothing
$$;
revoke execute on function public.documento_tipos_padrao(uuid) from public, anon, authenticated;
select public.documento_tipos_padrao(id) from public.empresas;

create or replace function public.provisionar_empresa(p_empresa uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nome text;
begin
  select nome into v_nome from public.empresas where id = p_empresa;
  insert into public.configuracoes (empresa_id, chave, valor) values
    (p_empresa, 'empresa', jsonb_build_object('nome', v_nome, 'sistema', 'GE EASY')),
    (p_empresa, 'comercial', jsonb_build_object('dias_alerta_renovacao', 30, 'moeda', 'BRL')),
    (p_empresa, 'documentacao', jsonb_build_object('prazo_dias', 45, 'contagem', 'corridos', 'avisos', jsonb_build_array(15, 7, 3, 1),
                                                   'max_prorrogacoes', 2, 'prorrogacao_dias', 15, 'comissao_apos_transferencia', false))
  on conflict do nothing;
  insert into public.departamentos (empresa_id, nome, sigla, descricao, cor, tipo) values
    (p_empresa, 'Comercial', 'COM', 'Consultores e captação de clientes', 'amber', 'consultor'),
    (p_empresa, 'Administrativo', 'ADM', 'Documentação, cadastros e base de clientes', 'slate', 'administrativo'),
    (p_empresa, 'Jurídico', 'JUR', 'Processos, intimações e audiências', 'brand', 'juridico'),
    (p_empresa, 'Recursos Humanos', 'RH', 'Funcionários, acessos e folha', 'sky', 'rh'),
    (p_empresa, 'Financeiro', 'FIN', 'Contas, recebimentos e folha de pagamento', 'green', 'financeiro')
  on conflict do nothing;
  perform public.documento_tipos_padrao(p_empresa);
end $$;

revoke execute on function public.situacao_documental(uuid), public.analisar_documento(uuid, public.documento_analise, text, date),
  public.prorrogar_documentacao(uuid, int, text), public.redistribuir_clientes(uuid[], uuid, text, boolean),
  public.verificar_documento_cliente(text), public.solicitar_transferencia_cliente(text, text),
  public.meus_clientes_transferidos(int), public.encaminhar_ao_juridico(uuid, text, public.processo_area, text),
  public.somar_prazo(timestamptz, int, text) from public, anon;
grant execute on function public.situacao_documental(uuid), public.analisar_documento(uuid, public.documento_analise, text, date),
  public.prorrogar_documentacao(uuid, int, text), public.redistribuir_clientes(uuid[], uuid, text, boolean),
  public.verificar_documento_cliente(text), public.solicitar_transferencia_cliente(text, text),
  public.meus_clientes_transferidos(int), public.encaminhar_ao_juridico(uuid, text, public.processo_area, text) to authenticated;
