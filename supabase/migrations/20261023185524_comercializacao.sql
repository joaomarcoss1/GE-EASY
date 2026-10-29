-- =====================================================================
-- GE EASY — Fase 10: comercialização
--
-- * planos (limites e módulos) e assinatura de cada empresa; cobrança pela Asaas (webhook com token,
--   idempotente): pago → ativa; vencido → inadimplente → suspensa após a tolerância; teste grátis com prazo;
-- * cadastro self-service de empresa (teste de 14 dias), com o administrador master;
-- * white-label (logo e cor) — o admin master edita a marca; logos num bucket público só de imagens;
-- * domínio próprio solicitado pela empresa (o servidor registra na Vercel e acompanha a verificação);
-- * portabilidade (exportação completa auditada) e exclusão agendada (anonimização após 30 dias);
-- * acesso de suporte temporário, pedido pela plataforma e autorizado pelo admin master, auditado e com prazo.
-- =====================================================================

create table public.planos (
  codigo text primary key check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nome text not null check (char_length(nome) between 2 and 80),
  descricao text check (char_length(descricao) <= 500),
  preco_mensal numeric(19,2) not null check (preco_mensal >= 0),
  limites jsonb not null default '{}'::jsonb, -- max_usuarios, dominio_proprio, whatsapp_numeros...
  modulos text[] not null default array['consultor', 'administrativo', 'juridico', 'rh', 'financeiro'],
  ordem int not null default 1,
  publico boolean not null default true,
  ativo boolean not null default true
);
insert into public.planos (codigo, nome, descricao, preco_mensal, limites, modulos, ordem) values
  ('essencial', 'Essencial', 'Carteira, app de campo, rotas e documentação', 199, '{"max_usuarios": 5, "dominio_proprio": false, "whatsapp_numeros": 1}', array['consultor', 'administrativo'], 1),
  ('profissional', 'Profissional', 'Todos os departamentos, WhatsApp e relatórios', 499, '{"max_usuarios": 20, "dominio_proprio": true, "whatsapp_numeros": 2}', array['consultor', 'administrativo', 'juridico', 'rh', 'financeiro'], 2),
  ('empresarial', 'Empresarial', 'Equipes grandes, vários números e domínio próprio', 1290, '{"max_usuarios": 100, "dominio_proprio": true, "whatsapp_numeros": 5}', array['consultor', 'administrativo', 'juridico', 'rh', 'financeiro'], 3)
on conflict (codigo) do nothing;
alter table public.planos enable row level security;
create policy planos_select on public.planos for select to anon, authenticated using (ativo and (publico or (select public.is_plataforma_admin())));
create policy planos_admin on public.planos for all to authenticated using ((select public.is_plataforma_admin())) with check ((select public.is_plataforma_admin()));

create table public.assinaturas (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  plano_codigo text not null references public.planos(codigo),
  status text not null default 'trial' check (status in ('trial', 'ativa', 'inadimplente', 'suspensa', 'cancelada')),
  trial_ate date,
  valor numeric(19,2),
  asaas_customer_id text,
  asaas_subscription_id text unique,
  proximo_vencimento date,
  inadimplente_desde date,
  ultimo_evento text,
  atualizado_em timestamptz not null default now()
);
alter table public.assinaturas enable row level security;
revoke all on public.assinaturas from anon;
create policy assinaturas_select on public.assinaturas for select to authenticated
  using ((select public.is_plataforma_admin()) or (empresa_id = (select public.empresa_atual()) and (select public.is_admin_master())));
create trigger trg_audit_assinaturas after insert or update or delete on public.assinaturas for each row execute function public.audit_trigger();

-- empresas atuais: assinatura conforme a situação
insert into public.assinaturas (empresa_id, plano_codigo, status, trial_ate)
select e.id, case when e.plano in (select codigo from public.planos) then e.plano else 'profissional' end,
       case when e.status = 'trial' then 'trial' when e.status = 'suspensa' then 'suspensa' when e.status = 'cancelada' then 'cancelada' else 'ativa' end,
       case when e.status = 'trial' then current_date + 14 end
  from public.empresas e
on conflict do nothing;

alter table public.empresas
  add column if not exists dominio_status text check (dominio_status in ('pendente', 'verificado', 'erro')),
  add column if not exists dominio_info jsonb,
  add column if not exists exclusao_agendada_para timestamptz,
  add column if not exists exclusao_solicitada_por uuid references public.profiles(id) on delete set null,
  add column if not exists anonimizada_em timestamptz;

-- plano → limites e módulos da empresa (aplicado pela plataforma/cobrança)
create or replace function public._aplicar_plano(p_empresa uuid, p_plano text)
returns void language plpgsql security definer set search_path = '' as $$
declare pl public.planos;
begin
  select * into pl from public.planos where codigo = p_plano;
  if not found then raise exception 'Plano inexistente.'; end if;
  update public.empresas set plano = pl.codigo, modulos = pl.modulos,
         limites = coalesce(limites, '{}'::jsonb) || pl.limites where id = p_empresa;
end $$;
revoke execute on function public._aplicar_plano(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Cadastro self-service (chamado pelo servidor depois de criar/convidar o usuário)
-- ---------------------------------------------------------------------
create or replace function public.cadastrar_empresa_publica(p_nome text, p_slug text, p_cnpj text, p_plano text, p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_plano text := coalesce(nullif(p_plano, ''), 'profissional');
begin
  if not exists (select 1 from public.planos where codigo = v_plano and ativo and publico) then raise exception 'Plano indisponível.'; end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' or p_slug in ('www', 'app', 'api', 'admin', 'plataforma', 'suporte', 'login', 'cadastro', 'mail', 'static') then
    raise exception 'Endereço inválido ou reservado.';
  end if;
  if exists (select 1 from public.empresas where slug = p_slug) then raise exception 'Este endereço já está em uso.' using errcode = '23505'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Usuário inválido.'; end if;
  insert into public.empresas (nome, slug, cnpj, plano, status) values (left(trim(p_nome), 160), p_slug, nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''), v_plano, 'trial')
  returning id into v_id;
  perform public.provisionar_empresa(v_id);
  perform public._aplicar_plano(v_id, v_plano);
  insert into public.assinaturas (empresa_id, plano_codigo, status, trial_ate) values (v_id, v_plano, 'trial', current_date + 14);
  insert into public.empresa_membros (empresa_id, user_id, role, ativo, admin_master) values (v_id, p_user, 'admin', true, true);
  update public.profiles set empresa_padrao_id = coalesce(empresa_padrao_id, v_id) where id = p_user;
  return v_id;
end $$;
revoke execute on function public.cadastrar_empresa_publica(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.cadastrar_empresa_publica(text, text, text, text, uuid) to service_role;

create or replace function public.slug_disponivel(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$' and not exists (select 1 from public.empresas where slug = lower(p_slug))
     and lower(p_slug) not in ('www', 'app', 'api', 'admin', 'plataforma', 'suporte', 'login', 'cadastro', 'mail', 'static')
$$;
revoke execute on function public.slug_disponivel(text) from public;
grant execute on function public.slug_disponivel(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Cobrança (Asaas): eventos do webhook, já autenticado pelo servidor
-- ---------------------------------------------------------------------
create or replace function public.aplicar_evento_cobranca(p_assinatura text, p_evento text, p_vencimento date, p_valor numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.assinaturas;
begin
  select * into a from public.assinaturas where asaas_subscription_id = p_assinatura for update;
  if not found then return jsonb_build_object('ignorado', true); end if;
  if p_evento in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED') then
    update public.assinaturas set status = 'ativa', inadimplente_desde = null, ultimo_evento = p_evento, atualizado_em = now(),
           proximo_vencimento = coalesce((p_vencimento + interval '1 month')::date, proximo_vencimento), valor = coalesce(p_valor, valor) where empresa_id = a.empresa_id;
    update public.empresas set status = 'ativa' where id = a.empresa_id and status in ('trial', 'suspensa') and exclusao_agendada_para is null;
  elsif p_evento = 'PAYMENT_OVERDUE' then
    update public.assinaturas set status = case when status = 'suspensa' then status else 'inadimplente' end, inadimplente_desde = coalesce(inadimplente_desde, coalesce(p_vencimento, current_date)),
           ultimo_evento = p_evento, atualizado_em = now() where empresa_id = a.empresa_id;
    insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
    select a.empresa_id, m.user_id, 'Pagamento da assinatura em atraso', 'Regularize para evitar a suspensão do acesso.', '/configuracoes?tab=assinatura'
      from public.empresa_membros m where m.empresa_id = a.empresa_id and m.ativo and m.admin_master;
  elsif p_evento in ('SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED') then
    update public.assinaturas set status = 'cancelada', ultimo_evento = p_evento, atualizado_em = now() where empresa_id = a.empresa_id;
  else
    update public.assinaturas set ultimo_evento = p_evento, atualizado_em = now() where empresa_id = a.empresa_id;
  end if;
  return jsonb_build_object('empresa_id', a.empresa_id, 'evento', p_evento);
end $$;
revoke execute on function public.aplicar_evento_cobranca(text, text, date, numeric) from public, anon, authenticated;
grant execute on function public.aplicar_evento_cobranca(text, text, date, numeric) to service_role;

-- rotina diária: suspende inadimplentes após a tolerância e testes vencidos; avisa antes do fim do teste
create or replace function public.processar_assinaturas(p_tolerancia_dias int default 7)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_susp int := 0; v_trial int := 0;
begin
  with s as (
    update public.assinaturas set status = 'suspensa', atualizado_em = now()
     where status = 'inadimplente' and inadimplente_desde < current_date - p_tolerancia_dias returning empresa_id
  ) update public.empresas e set status = 'suspensa' from s where e.id = s.empresa_id and e.status = 'ativa';
  get diagnostics v_susp = row_count;
  with t as (
    update public.assinaturas set status = 'suspensa', atualizado_em = now()
     where status = 'trial' and trial_ate < current_date - 3 returning empresa_id
  ) update public.empresas e set status = 'suspensa' from t where e.id = t.empresa_id and e.status = 'trial';
  get diagnostics v_trial = row_count;
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link, chave)
  select a.empresa_id, m.user_id, 'Seu teste termina em breve', 'O período de teste termina em ' || to_char(a.trial_ate, 'DD/MM') || '. Escolha um plano para continuar.', '/configuracoes?tab=assinatura',
         'trial-fim:' || a.empresa_id
    from public.assinaturas a join public.empresa_membros m on m.empresa_id = a.empresa_id and m.ativo and m.admin_master
   where a.status = 'trial' and a.trial_ate between current_date and current_date + 3
  on conflict (user_id, chave) where chave is not null do nothing;
  return jsonb_build_object('suspensas_inadimplencia', v_susp, 'suspensas_teste', v_trial);
end $$;
revoke execute on function public.processar_assinaturas(int) from public, anon, authenticated;
select cron.schedule('geeasy-assinaturas', '0 7 * * *', $$select public.processar_assinaturas(7)$$);

-- o servidor registra o cliente/assinatura criados na Asaas para a empresa (admin master escolheu o plano)
create or replace function public.registrar_assinatura_asaas(p_empresa uuid, p_plano text, p_customer text, p_subscription text, p_valor numeric, p_vencimento date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.assinaturas set plano_codigo = p_plano, asaas_customer_id = p_customer, asaas_subscription_id = p_subscription, valor = p_valor,
         proximo_vencimento = p_vencimento, atualizado_em = now() where empresa_id = p_empresa;
  if not found then
    insert into public.assinaturas (empresa_id, plano_codigo, status, asaas_customer_id, asaas_subscription_id, valor, proximo_vencimento)
    values (p_empresa, p_plano, 'trial', p_customer, p_subscription, p_valor, p_vencimento);
  end if;
  perform public._aplicar_plano(p_empresa, p_plano);
end $$;
revoke execute on function public.registrar_assinatura_asaas(uuid, text, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.registrar_assinatura_asaas(uuid, text, text, text, numeric, date) to service_role;

-- ---------------------------------------------------------------------
-- Domínio próprio (admin master; o plano precisa permitir)
-- ---------------------------------------------------------------------
create or replace function public.definir_dominio(p_dominio text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := public.empresa_atual(); v_dom text := lower(trim(p_dominio));
begin
  if not public.is_admin_master() then raise exception 'Somente o administrador master.' using errcode = '42501'; end if;
  if v_dom = '' then
    perform set_config('geeasy.dominio', 'on', true);
    update public.empresas set dominio = null, dominio_status = null, dominio_info = null where id = v_emp;
    perform set_config('geeasy.dominio', 'off', true);
    return;
  end if;
  if not coalesce((select (limites->>'dominio_proprio')::boolean from public.empresas where id = v_emp), false) then
    raise exception 'O plano atual não inclui domínio próprio.';
  end if;
  if v_dom !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$' then raise exception 'Domínio inválido.'; end if;
  if exists (select 1 from public.empresas where dominio = v_dom and id <> v_emp) then raise exception 'Domínio já usado por outra empresa.' using errcode = '23505'; end if;
  perform set_config('geeasy.dominio', 'on', true);
  update public.empresas set dominio = v_dom, dominio_status = 'pendente', dominio_info = null where id = v_emp;
  perform set_config('geeasy.dominio', 'off', true);
end $$;
revoke execute on function public.definir_dominio(text) from public, anon;
grant execute on function public.definir_dominio(text) to authenticated;

create or replace function public.protect_empresa()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_plataforma_admin() then return new; end if;
  -- domínio: só pela função definir_dominio; exclusão: só pelas funções de agendamento
  if new.dominio is distinct from old.dominio and coalesce(current_setting('geeasy.dominio', true), '') <> 'on' then
    raise exception 'Use a tela de domínio próprio.' using errcode = '42501';
  end if;
  if (new.exclusao_agendada_para, new.anonimizada_em) is distinct from (old.exclusao_agendada_para, old.anonimizada_em) and coalesce(current_setting('geeasy.exclusao', true), '') <> 'on' then
    raise exception 'Use a tela de exclusão de dados.' using errcode = '42501';
  end if;
  if (new.slug, new.plano, new.status, new.limites, new.modulos) is distinct from (old.slug, old.plano, old.status, old.limites, old.modulos) then
    raise exception 'Plano, situação, limites, endereço e módulos são definidos pela plataforma' using errcode = '42501';
  end if;
  return new;
end $$;

