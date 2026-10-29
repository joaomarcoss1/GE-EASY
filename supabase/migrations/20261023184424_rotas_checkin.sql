-- =====================================================================
-- GE EASY — Fase 5: rotas, check-in com GPS, quilometragem, tempos e gastos
--
-- * o administrativo planeja rotas (consultor, data, veículo, paradas com raio e janela);
-- * o consultor inicia, faz check-in (chegada/saída) em cada parada e finaliza; o servidor calcula a
--   distância até a parada, o raio e os sinais de fraude (precisão, horário do aparelho, salto de
--   velocidade, ponto repetido, localização simulada) — marca para revisão em vez de travar o campo;
-- * km (hodômetro ou linha reta × fator rodoviário), tempo de locomoção e em visita, custo da rota
--   (km × R$/km ou consumo × combustível + despesas aprovadas) e custo por cliente visitado/adquirido;
-- * despesas com comprovante e aprovação; paradas não realizadas reagendadas para outra rota.
-- =====================================================================

create type public.rota_status as enum ('planejada', 'em_andamento', 'concluida', 'aprovada', 'cancelada');
create type public.parada_status as enum ('pendente', 'visitada', 'nao_realizada', 'reagendada');
create type public.despesa_status as enum ('lancada', 'aprovada', 'recusada', 'reembolsada');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  descricao text not null check (char_length(descricao) between 2 and 120),
  placa text check (placa is null or placa ~ '^[A-Z0-9-]{5,10}$'),
  consumo_km_l numeric(6,2) check (consumo_km_l is null or consumo_km_l > 0),
  responsavel_id uuid references public.profiles(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.veiculos (empresa_id);

create table public.rotas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  nome text not null check (char_length(nome) between 2 and 160),
  data date not null,
  consultor_id uuid not null references public.profiles(id) on delete restrict,
  veiculo_id uuid references public.veiculos(id) on delete set null,
  status public.rota_status not null default 'planejada',
  objetivo text check (char_length(objetivo) <= 2000),
  km_planejado numeric(10,2) check (km_planejado is null or km_planejado >= 0),
  tempo_planejado_min int check (tempo_planejado_min is null or tempo_planejado_min >= 0),
  metodo_km text not null default 'linha_reta' check (metodo_km in ('linha_reta', 'google', 'rastreio', 'hodometro')),
  iniciada_em timestamptz,
  inicio_lat double precision check (inicio_lat between -90 and 90),
  inicio_lng double precision check (inicio_lng between -180 and 180),
  finalizada_em timestamptz,
  fim_lat double precision check (fim_lat between -90 and 90),
  fim_lng double precision check (fim_lng between -180 and 180),
  hodometro_inicio int check (hodometro_inicio is null or hodometro_inicio >= 0),
  hodometro_fim int check (hodometro_fim is null or hodometro_fim >= 0),
  hodometro_foto_inicio text,
  hodometro_foto_fim text,
  resumo jsonb,
  aprovada_por uuid references public.profiles(id) on delete set null,
  aprovada_em timestamptz,
  observacoes text check (char_length(observacoes) <= 4000),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.rotas (empresa_id, data desc);
create index on public.rotas (empresa_id, consultor_id, data desc);
create index on public.rotas (empresa_id, status) where status in ('planejada', 'em_andamento', 'concluida');
create trigger trg_rotas_updated before update on public.rotas for each row execute function public.set_updated_at();

create table public.rota_paradas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  rota_id uuid not null references public.rotas(id) on delete cascade,
  ordem int not null default 1 check (ordem between 1 and 500),
  tipo text not null default 'cliente' check (tipo in ('cliente', 'cidade', 'endereco', 'ponto_interesse')),
  cliente_id uuid references public.clientes(id) on delete set null,
  titulo text not null check (char_length(titulo) between 2 and 200),
  endereco text check (char_length(endereco) <= 300),
  cidade text check (char_length(cidade) <= 120),
  uf char(2),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  raio_m int check (raio_m is null or raio_m between 20 and 5000),
  janela_inicio time,
  janela_fim time,
  objetivo text check (char_length(objetivo) <= 1000),
  obrigatoria boolean not null default true,
  status public.parada_status not null default 'pendente',
  motivo text check (char_length(motivo) <= 500),
  reagendada_para uuid references public.rotas(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.rota_paradas (rota_id, ordem);
create index on public.rota_paradas (empresa_id, cliente_id) where cliente_id is not null;

create table public.checkins (
  id uuid primary key, -- gerado no aparelho (idempotência do modo offline)
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  rota_id uuid not null references public.rotas(id) on delete cascade,
  parada_id uuid references public.rota_paradas(id) on delete set null,
  consultor_id uuid not null references public.profiles(id) on delete restrict,
  tipo text not null check (tipo in ('chegada', 'saida')),
  registrado_em timestamptz not null default now(),
  dispositivo_em timestamptz,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  precisao double precision check (precisao is null or precisao >= 0),
  distancia_m int check (distancia_m is null or distancia_m >= 0),
  dentro_do_raio boolean,
  justificativa text check (char_length(justificativa) <= 500),
  foto_path text,
  resultado text check (resultado in ('visitado', 'ausente', 'reagendado', 'venda', 'recusa', 'pre_cadastro')),
  observacao text check (char_length(observacao) <= 2000),
  flags text[] not null default '{}',
  revisao text check (revisao in ('pendente', 'aprovado', 'rejeitado')),
  revisado_por uuid references public.profiles(id) on delete set null,
  revisado_em timestamptz,
  dispositivo_id uuid references public.dispositivos(id) on delete set null
);
create index on public.checkins (empresa_id, registrado_em desc);
create index on public.checkins (rota_id, registrado_em);
create index on public.checkins (empresa_id, consultor_id, registrado_em desc);
create index on public.checkins (empresa_id, revisao) where revisao = 'pendente';

create table public.despesas_rota (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete restrict,
  rota_id uuid references public.rotas(id) on delete set null,
  consultor_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  tipo text not null check (tipo in ('combustivel', 'pedagio', 'alimentacao', 'estacionamento', 'hospedagem', 'outros')),
  valor numeric(19,2) not null check (valor > 0 and valor < 100000),
  data date not null default (now() at time zone 'America/Sao_Paulo')::date,
  descricao text check (char_length(descricao) <= 500),
  comprovante_path text,
  hodometro int check (hodometro is null or hodometro >= 0),
  status public.despesa_status not null default 'lancada',
  aprovador_id uuid references public.profiles(id) on delete set null,
  aprovado_em timestamptz,
  motivo text check (char_length(motivo) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.despesas_rota (empresa_id, status, data desc);
create index on public.despesas_rota (empresa_id, consultor_id, data desc);
create index on public.despesas_rota (rota_id);
create trigger trg_despesas_updated before update on public.despesas_rota for each row execute function public.set_updated_at();

-- integridade entre empresas e auditoria
create trigger zz_empresa_vinculos before insert or update on public.veiculos for each row execute function public.empresa_vinculos('responsavel_id:@');
create trigger zz_empresa_vinculos before insert or update on public.rotas for each row execute function public.empresa_vinculos('veiculo_id:veiculos', 'consultor_id:@');
create trigger zz_empresa_vinculos before insert or update on public.rota_paradas for each row execute function public.empresa_vinculos('rota_id:rotas', 'cliente_id:clientes');
create trigger zz_empresa_vinculos before insert or update on public.checkins for each row execute function public.empresa_vinculos('rota_id:rotas', 'parada_id:rota_paradas', 'consultor_id:@');
create trigger zz_empresa_vinculos before insert or update on public.despesas_rota for each row execute function public.empresa_vinculos('rota_id:rotas', 'consultor_id:@');
do $$
declare t text;
begin
  foreach t in array array['veiculos', 'rotas', 'rota_paradas', 'checkins', 'despesas_rota'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Parâmetros e cálculos
-- ---------------------------------------------------------------------
create or replace function public.parametros_rotas(p_empresa uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('raio_m', 150, 'fora_do_raio', 'justificar', 'reembolso_modo', 'km', 'valor_km', 0.9,
                            'consumo_km_l', 10, 'preco_combustivel', 6, 'fator_rodoviario', 1.3, 'exigir_hodometro', false,
                            'exigir_selfie', false, 'rastreio', false)
         || coalesce((select c.valor from public.configuracoes c where c.empresa_id = p_empresa and c.chave = 'rotas'), '{}'::jsonb)
$$;
revoke execute on function public.parametros_rotas(uuid) from public, anon, authenticated;

-- distância em linha reta (haversine, metros)
create or replace function public.geo_distancia_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

create or replace function public.pode_ver_rota(p_consultor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_consultor = auth.uid() or public.is_manager() or public.tem_permissao('rotas.ver') or public.tem_permissao('rotas.aprovar')
      or public.tem_permissao('despesas.aprovar') or public.is_supervisor_de(p_consultor)
$$;
revoke execute on function public.pode_ver_rota(uuid) from public, anon;
grant execute on function public.pode_ver_rota(uuid) to authenticated;

/**
 * Resumo calculado de uma rota (km, tempos, custos e indicadores) — mesma fórmula usada nos relatórios.
 * Km: hodômetro (fim − início) quando informado; senão soma das distâncias em linha reta × fator
 * rodoviário entre o início, as chegadas (em ordem) e o fim.
 */
create or replace function public.rota_resumo(p_rota uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.rotas; v_cfg jsonb; v_consumo numeric; v_fator numeric;
  v_pontos record; v_prev_lat double precision; v_prev_lng double precision; v_reta double precision := 0;
  v_km numeric; v_metodo text; v_locomocao numeric := 0; v_visita numeric := 0;
  v_ult_saida timestamptz; v_paradas int; v_visitadas int; v_nao int; v_fora int; v_incons int; v_adq int;
  v_desp numeric; v_desp_lancadas numeric; v_custo_km numeric; v_total numeric;
begin
  select * into r from public.rotas where id = p_rota;
  if not found then return null; end if;
  v_cfg := public.parametros_rotas(r.empresa_id);
  select coalesce(v.consumo_km_l, (v_cfg->>'consumo_km_l')::numeric) into v_consumo from (select 1) x left join public.veiculos v on v.id = r.veiculo_id;
  v_fator := greatest(1, coalesce((v_cfg->>'fator_rodoviario')::numeric, 1.3));

  -- percurso: início → chegadas em ordem → fim
  v_prev_lat := r.inicio_lat; v_prev_lng := r.inicio_lng;
  for v_pontos in
    select lat, lng from (
      select c.lat, c.lng, c.registrado_em as t from public.checkins c where c.rota_id = p_rota and c.tipo = 'chegada'
      union all select r.fim_lat, r.fim_lng, coalesce(r.finalizada_em, 'infinity'::timestamptz) where r.fim_lat is not null
    ) x order by t
  loop
    if v_prev_lat is not null then v_reta := v_reta + public.geo_distancia_m(v_prev_lat, v_prev_lng, v_pontos.lat, v_pontos.lng); end if;
    v_prev_lat := v_pontos.lat; v_prev_lng := v_pontos.lng;
  end loop;
  if r.hodometro_inicio is not null and r.hodometro_fim is not null and r.hodometro_fim >= r.hodometro_inicio then
    v_km := r.hodometro_fim - r.hodometro_inicio; v_metodo := 'hodometro';
  else
    v_km := round((v_reta / 1000 * v_fator)::numeric, 2); v_metodo := 'linha_reta';
  end if;

  -- tempos: em visita = chegada → saída da mesma parada; locomoção = saída anterior (ou início) → próxima chegada
  v_ult_saida := r.iniciada_em;
  for v_pontos in
    select c.parada_id, min(c.registrado_em) filter (where c.tipo = 'chegada') as chegada, max(c.registrado_em) filter (where c.tipo = 'saida') as saida
      from public.checkins c where c.rota_id = p_rota group by c.parada_id order by min(c.registrado_em)
  loop
    if v_pontos.chegada is not null and v_ult_saida is not null and v_pontos.chegada > v_ult_saida then
      v_locomocao := v_locomocao + extract(epoch from v_pontos.chegada - v_ult_saida) / 60;
    end if;
    if v_pontos.chegada is not null and v_pontos.saida is not null and v_pontos.saida > v_pontos.chegada then
      v_visita := v_visita + extract(epoch from v_pontos.saida - v_pontos.chegada) / 60;
    end if;
    v_ult_saida := coalesce(v_pontos.saida, v_pontos.chegada, v_ult_saida);
  end loop;
  if r.finalizada_em is not null and v_ult_saida is not null and r.finalizada_em > v_ult_saida then
    v_locomocao := v_locomocao + extract(epoch from r.finalizada_em - v_ult_saida) / 60;
  end if;

  select count(*), count(*) filter (where status = 'visitada'), count(*) filter (where status in ('nao_realizada', 'reagendada'))
    into v_paradas, v_visitadas, v_nao from public.rota_paradas where rota_id = p_rota;
  select count(*) filter (where dentro_do_raio = false and tipo = 'chegada'), count(*) filter (where cardinality(flags) > 0),
         count(distinct parada_id) filter (where resultado in ('venda', 'pre_cadastro'))
    into v_fora, v_incons, v_adq from public.checkins where rota_id = p_rota;
  select coalesce(sum(valor) filter (where status in ('aprovada', 'reembolsada')), 0), coalesce(sum(valor) filter (where status = 'lancada'), 0)
    into v_desp, v_desp_lancadas from public.despesas_rota where rota_id = p_rota;

  v_custo_km := case when v_cfg->>'reembolso_modo' = 'consumo'
                     then round(v_km / greatest(v_consumo, 0.1) * coalesce((v_cfg->>'preco_combustivel')::numeric, 0), 2)
                     else round(v_km * coalesce((v_cfg->>'valor_km')::numeric, 0), 2) end;
  v_total := v_custo_km + v_desp;
  return jsonb_build_object(
    'km', v_km, 'metodo_km', v_metodo, 'km_linha_reta', round((v_reta / 1000)::numeric, 2),
    'tempo_locomocao_min', round(v_locomocao), 'tempo_visita_min', round(v_visita),
    'paradas', v_paradas, 'visitadas', v_visitadas, 'nao_realizadas', v_nao, 'fora_do_raio', v_fora, 'inconsistencias', v_incons,
    'adquiridos', v_adq, 'custo_km', v_custo_km, 'despesas_aprovadas', v_desp, 'despesas_pendentes', v_desp_lancadas, 'custo_total', v_total,
    'custo_por_visitado', case when v_visitadas > 0 then round(v_total / v_visitadas, 2) end,
    'custo_por_adquirido', case when v_adq > 0 then round(v_total / v_adq, 2) end
  );
end $$;
revoke execute on function public.rota_resumo(uuid) from public, anon, authenticated;

-- resumo para a tela (respeita quem pode ver a rota)
create or replace function public.resumo_da_rota(p_rota uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cons uuid;
begin
  select consultor_id into v_cons from public.rotas where id = p_rota and empresa_id = public.empresa_atual();
  if v_cons is null or not public.pode_ver_rota(v_cons) then return null; end if;
  return public.rota_resumo(p_rota);
end $$;
revoke execute on function public.resumo_da_rota(uuid) from public, anon;
grant execute on function public.resumo_da_rota(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Execução da rota (consultor)
-- ---------------------------------------------------------------------
create or replace function public.iniciar_rota(p_rota uuid, p_lat double precision, p_lng double precision, p_hodometro int default null, p_foto text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.rotas; v_cfg jsonb;
begin
  if not public.tem_permissao('rotas.executar') then raise exception 'Sem permissão para executar rotas.' using errcode = '42501'; end if;
  select * into r from public.rotas where id = p_rota and empresa_id = public.empresa_atual() for update;
  if not found or r.consultor_id <> auth.uid() then raise exception 'Rota não encontrada.' using errcode = '42501'; end if;
  if r.status <> 'planejada' then raise exception 'A rota já foi iniciada ou encerrada.'; end if;
  if exists (select 1 from public.rotas where consultor_id = auth.uid() and status = 'em_andamento' and id <> p_rota) then
    raise exception 'Finalize a rota em andamento antes de iniciar outra.';
  end if;
  v_cfg := public.parametros_rotas(r.empresa_id);
  if coalesce((v_cfg->>'exigir_hodometro')::boolean, false) and p_hodometro is null then raise exception 'Informe o hodômetro (e a foto) para iniciar.'; end if;
  update public.rotas set status = 'em_andamento', iniciada_em = now(), inicio_lat = p_lat, inicio_lng = p_lng,
         hodometro_inicio = p_hodometro, hodometro_foto_inicio = p_foto
   where id = p_rota;
end $$;

/**
 * Check-in (chegada/saída) numa parada. Idempotente pelo id gerado no aparelho. Dentro do raio = válido;
 * fora do raio: bloqueia ou exige justificativa (configurável) e marca para revisão. Sinais de fraude
 * também marcam para revisão sem travar o trabalho.
 */
create or replace function public.registrar_checkin(
  p_id uuid, p_parada uuid, p_tipo text, p_lat double precision, p_lng double precision, p_precisao double precision default null,
  p_dispositivo_em timestamptz default null, p_resultado text default null, p_observacao text default null,
  p_justificativa text default null, p_mock boolean default false, p_foto text default null, p_dispositivo uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pa public.rota_paradas; r public.rotas; v_cfg jsonb; v_raio int; v_dist int; v_dentro boolean; v_flags text[] := '{}';
  v_ant public.checkins; v_vel double precision; v_existente public.checkins;
begin
  select * into v_existente from public.checkins where id = p_id;
  if found then
    if v_existente.consultor_id <> auth.uid() then raise exception 'Identificador de check-in inválido.' using errcode = '42501'; end if;
    return jsonb_build_object('id', v_existente.id, 'dentro_do_raio', v_existente.dentro_do_raio, 'distancia_m', v_existente.distancia_m, 'flags', v_existente.flags, 'repetido', true);
  end if;
  if not public.tem_permissao('rotas.executar') then raise exception 'Sem permissão para executar rotas.' using errcode = '42501'; end if;
  if p_tipo not in ('chegada', 'saida') then raise exception 'Tipo de check-in inválido.'; end if;
  if p_lat is null or p_lng is null or (p_lat = 0 and p_lng = 0) or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Localização inválida.'; end if;
  select * into pa from public.rota_paradas where id = p_parada and empresa_id = public.empresa_atual();
  if not found then raise exception 'Parada não encontrada.'; end if;
  select * into r from public.rotas where id = pa.rota_id for update;
  if r.consultor_id <> auth.uid() then raise exception 'Esta rota não é sua.' using errcode = '42501'; end if;
  if r.status = 'planejada' then raise exception 'Inicie a rota antes do check-in.'; end if;
  if r.status <> 'em_andamento' then raise exception 'A rota já foi encerrada.'; end if;
  if p_tipo = 'saida' and not exists (select 1 from public.checkins where parada_id = p_parada and tipo = 'chegada') then
    raise exception 'Registre a chegada antes da saída.';
  end if;
  if p_tipo = 'chegada' and exists (select 1 from public.checkins where parada_id = p_parada and tipo = 'chegada') then
    raise exception 'A chegada nesta parada já foi registrada.';
  end if;
  v_cfg := public.parametros_rotas(r.empresa_id);

  -- raio
  if pa.lat is not null and pa.lng is not null then
    v_raio := coalesce(pa.raio_m, (v_cfg->>'raio_m')::int, 150);
    v_dist := round(public.geo_distancia_m(p_lat, p_lng, pa.lat, pa.lng));
    v_dentro := v_dist <= v_raio;
    if not v_dentro and p_tipo = 'chegada' then
      if v_cfg->>'fora_do_raio' = 'bloquear' then
        raise exception 'Você está a % m da parada (raio de % m). Check-in fora do raio não é permitido.', v_dist, v_raio using errcode = '23514';
      elsif coalesce(trim(p_justificativa), '') = '' then
        raise exception 'Você está a % m da parada (raio de % m). Informe a justificativa.', v_dist, v_raio using errcode = '23514';
      end if;
    end if;
  end if;

  -- sinais de fraude (marcam para revisão)
  if p_mock then v_flags := array_append(v_flags, 'localizacao_simulada'); end if;
  if p_precisao is not null and p_precisao > 100 then v_flags := array_append(v_flags, 'precisao_ruim'); end if;
  if p_dispositivo_em is not null and abs(extract(epoch from p_dispositivo_em - now())) > 300 then v_flags := array_append(v_flags, 'horario_divergente'); end if;
  select * into v_ant from public.checkins where consultor_id = auth.uid() and registrado_em > now() - interval '12 hours' order by registrado_em desc limit 1;
  if found then
    v_vel := public.geo_distancia_m(v_ant.lat, v_ant.lng, p_lat, p_lng) / greatest(extract(epoch from now() - v_ant.registrado_em), 1) * 3.6;
    if v_vel > 150 then v_flags := array_append(v_flags, 'salto_velocidade'); end if;
    if v_ant.parada_id is distinct from p_parada and public.geo_distancia_m(v_ant.lat, v_ant.lng, p_lat, p_lng) < 5 then v_flags := array_append(v_flags, 'ponto_repetido'); end if;
  end if;

  insert into public.checkins (id, empresa_id, rota_id, parada_id, consultor_id, tipo, dispositivo_em, lat, lng, precisao, distancia_m, dentro_do_raio,
                               justificativa, foto_path, resultado, observacao, flags, revisao, dispositivo_id)
  values (p_id, r.empresa_id, r.id, p_parada, auth.uid(), p_tipo, p_dispositivo_em, p_lat, p_lng, p_precisao, v_dist, v_dentro,
          nullif(trim(p_justificativa), ''), p_foto, case when p_tipo = 'saida' then p_resultado end, left(p_observacao, 2000), v_flags,
          case when cardinality(v_flags) > 0 or v_dentro = false then 'pendente' end, p_dispositivo);

  if p_tipo = 'chegada' then
    update public.rota_paradas set status = 'visitada' where id = p_parada;
  end if;
  return jsonb_build_object('id', p_id, 'dentro_do_raio', v_dentro, 'distancia_m', v_dist, 'raio_m', v_raio, 'flags', v_flags, 'repetido', false);
end $$;

create or replace function public.finalizar_rota(p_rota uuid, p_lat double precision default null, p_lng double precision default null,
  p_hodometro int default null, p_foto text default null, p_nao_realizadas jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.rotas; v_item jsonb; v_resumo jsonb; v_cfg jsonb;
begin
  select * into r from public.rotas where id = p_rota and empresa_id = public.empresa_atual() for update;
  if not found or r.consultor_id <> auth.uid() then raise exception 'Rota não encontrada.' using errcode = '42501'; end if;
  if r.status <> 'em_andamento' then raise exception 'A rota não está em andamento.'; end if;
  v_cfg := public.parametros_rotas(r.empresa_id);
  if coalesce((v_cfg->>'exigir_hodometro')::boolean, false) and p_hodometro is null then raise exception 'Informe o hodômetro final.'; end if;
  if p_hodometro is not null and r.hodometro_inicio is not null and p_hodometro < r.hodometro_inicio then raise exception 'Hodômetro final menor que o inicial.'; end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_nao_realizadas, '[]'::jsonb)) loop
    update public.rota_paradas set status = 'nao_realizada', motivo = left(coalesce(v_item->>'motivo', 'Não informado'), 500)
     where id = (v_item->>'parada_id')::uuid and rota_id = p_rota and status = 'pendente';
  end loop;
  update public.rota_paradas set status = 'nao_realizada', motivo = coalesce(motivo, 'Não visitada')
   where rota_id = p_rota and status = 'pendente';
  update public.rotas set status = 'concluida', finalizada_em = now(), fim_lat = p_lat, fim_lng = p_lng, hodometro_fim = p_hodometro,
         hodometro_foto_fim = p_foto, metodo_km = case when r.hodometro_inicio is not null and p_hodometro is not null then 'hodometro' else metodo_km end
   where id = p_rota;
  v_resumo := public.rota_resumo(p_rota);
  update public.rotas set resumo = v_resumo where id = p_rota;
  -- supervisão: avisar quem aprova
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  select distinct r.empresa_id, e.supervisor_id, 'Rota concluída para aprovação', left(r.nome || ': ' || (v_resumo->>'km') || ' km, ' || (v_resumo->>'visitadas') || ' visita(s)', 300), '/rotas/' || r.id
    from public.equipe_membros e where e.empresa_id = r.empresa_id and e.membro_id = r.consultor_id;
  return v_resumo;
end $$;

-- ---------------------------------------------------------------------
-- Supervisão: aprovar rota, revisar check-in, aprovar despesa, reagendar
-- ---------------------------------------------------------------------
create or replace function public.aprovar_rota(p_rota uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.rotas; v_resumo jsonb;
begin
  if not (public.tem_permissao('rotas.aprovar') or public.is_manager()) then raise exception 'Sem permissão para aprovar rotas.' using errcode = '42501'; end if;
  select * into r from public.rotas where id = p_rota and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Rota não encontrada.'; end if;
  if r.consultor_id = auth.uid() then raise exception 'Você não aprova a sua própria rota.' using errcode = '42501'; end if;
  if r.status <> 'concluida' then raise exception 'Somente rotas concluídas são aprovadas.'; end if;
  v_resumo := public.rota_resumo(p_rota);
  update public.rotas set status = 'aprovada', aprovada_por = auth.uid(), aprovada_em = now(), resumo = v_resumo where id = p_rota;
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  values (r.empresa_id, r.consultor_id, 'Rota aprovada', left(r.nome, 300), '/rotas/' || r.id);
  return v_resumo;
end $$;

create or replace function public.revisar_checkin(p_checkin uuid, p_aprovar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.checkins;
begin
  if not (public.tem_permissao('rotas.aprovar') or public.is_manager()) then raise exception 'Sem permissão para revisar check-ins.' using errcode = '42501'; end if;
  select * into c from public.checkins where id = p_checkin and empresa_id = public.empresa_atual();
  if not found then raise exception 'Check-in não encontrado.'; end if;
  if c.consultor_id = auth.uid() then raise exception 'Você não revisa o próprio check-in.' using errcode = '42501'; end if;
  update public.checkins set revisao = case when p_aprovar then 'aprovado' else 'rejeitado' end, revisado_por = auth.uid(), revisado_em = now()
   where id = p_checkin;
end $$;

create or replace function public.aprovar_despesa(p_despesa uuid, p_aprovar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.despesas_rota;
begin
  if not (public.tem_permissao('despesas.aprovar') or public.is_manager()) then raise exception 'Sem permissão para aprovar despesas.' using errcode = '42501'; end if;
  select * into d from public.despesas_rota where id = p_despesa and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Despesa não encontrada.'; end if;
  if d.consultor_id = auth.uid() then raise exception 'Você não aprova a sua própria despesa.' using errcode = '42501'; end if;
  if d.status <> 'lancada' then raise exception 'A despesa já foi analisada.'; end if;
  if not p_aprovar and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  update public.despesas_rota set status = case when p_aprovar then 'aprovada' else 'recusada' end::public.despesa_status,
         aprovador_id = auth.uid(), aprovado_em = now(), motivo = nullif(trim(p_motivo), '')
   where id = p_despesa;
  if d.rota_id is not null then
    update public.rotas set resumo = public.rota_resumo(d.rota_id) where id = d.rota_id and status in ('concluida', 'aprovada');
  end if;
  insert into public.notificacoes (empresa_id, user_id, titulo, mensagem, link)
  values (d.empresa_id, d.consultor_id, case when p_aprovar then 'Despesa aprovada' else 'Despesa recusada' end,
          left(to_char(d.valor, 'FM999G999D00') || ' — ' || coalesce(p_motivo, d.tipo), 300), '/rotas/despesas');
end $$;

-- Paradas não realizadas vão para outra rota (planejada) com um clique
create or replace function public.reagendar_paradas(p_paradas uuid[], p_rota_destino uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_dest public.rotas; n int := 0; v_ordem int; p public.rota_paradas;
begin
  if not (public.tem_permissao('rotas.definir') or public.is_manager()) then raise exception 'Sem permissão para reagendar paradas.' using errcode = '42501'; end if;
  select * into v_dest from public.rotas where id = p_rota_destino and empresa_id = public.empresa_atual();
  if not found or v_dest.status <> 'planejada' then raise exception 'Escolha uma rota planejada de destino.'; end if;
  select coalesce(max(ordem), 0) into v_ordem from public.rota_paradas where rota_id = p_rota_destino;
  for p in select * from public.rota_paradas where id = any(p_paradas) and empresa_id = v_dest.empresa_id and status in ('nao_realizada', 'pendente') loop
    v_ordem := v_ordem + 1;
    insert into public.rota_paradas (empresa_id, rota_id, ordem, tipo, cliente_id, titulo, endereco, cidade, uf, lat, lng, raio_m, janela_inicio, janela_fim, objetivo, obrigatoria)
    values (p.empresa_id, p_rota_destino, least(v_ordem, 500), p.tipo, p.cliente_id, p.titulo, p.endereco, p.cidade, p.uf, p.lat, p.lng, p.raio_m, p.janela_inicio, p.janela_fim, p.objetivo, p.obrigatoria);
    update public.rota_paradas set status = 'reagendada', reagendada_para = p_rota_destino where id = p.id;
    n := n + 1;
  end loop;
  return n;
end $$;

/** Relatório de rotas no período (km, tempos, custos, visitas) — base dos relatórios gerenciais. */
create or replace function public.relatorio_rotas(p_inicio date, p_fim date, p_consultor uuid default null)
returns table (rota_id uuid, nome text, data date, consultor_id uuid, status public.rota_status, km_planejado numeric, resumo jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.tem_permissao('rotas.ver') or public.tem_permissao('relatorios.view') or public.is_manager() or public.tem_permissao('rotas.executar')) then
    raise exception 'Sem permissão.' using errcode = '42501';
  end if;
  return query
  select r.id, r.nome, r.data, r.consultor_id, r.status, r.km_planejado,
         case when r.status in ('concluida', 'aprovada') and r.resumo is not null then r.resumo else public.rota_resumo(r.id) end
    from public.rotas r
   where r.empresa_id = public.empresa_atual() and r.data between p_inicio and p_fim and r.status <> 'cancelada'
     and (p_consultor is null or r.consultor_id = p_consultor)
     and public.pode_ver_rota(r.consultor_id)
   order by r.data, r.nome;
end $$;

revoke execute on function public.iniciar_rota(uuid, double precision, double precision, int, text),
  public.registrar_checkin(uuid, uuid, text, double precision, double precision, double precision, timestamptz, text, text, text, boolean, text, uuid),
  public.finalizar_rota(uuid, double precision, double precision, int, text, jsonb), public.aprovar_rota(uuid),
  public.revisar_checkin(uuid, boolean), public.aprovar_despesa(uuid, boolean, text), public.reagendar_paradas(uuid[], uuid),
  public.relatorio_rotas(date, date, uuid) from public, anon;
grant execute on function public.iniciar_rota(uuid, double precision, double precision, int, text),
  public.registrar_checkin(uuid, uuid, text, double precision, double precision, double precision, timestamptz, text, text, text, boolean, text, uuid),
  public.finalizar_rota(uuid, double precision, double precision, int, text, jsonb), public.aprovar_rota(uuid),
  public.revisar_checkin(uuid, boolean), public.aprovar_despesa(uuid, boolean, text), public.reagendar_paradas(uuid[], uuid),
  public.relatorio_rotas(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.veiculos enable row level security;
alter table public.rotas enable row level security;
alter table public.rota_paradas enable row level security;
alter table public.checkins enable row level security;
alter table public.despesas_rota enable row level security;

create policy veiculos_select on public.veiculos for select to authenticated using ((select public.is_active_user()));
create policy veiculos_insert on public.veiculos for insert to authenticated with check ((select public.tem_permissao('rotas.definir')));
create policy veiculos_update on public.veiculos for update to authenticated using ((select public.tem_permissao('rotas.definir')));

create policy rotas_select on public.rotas for select to authenticated using (public.pode_ver_rota(consultor_id));
create policy rotas_insert on public.rotas for insert to authenticated with check ((select public.tem_permissao('rotas.definir')) and status = 'planejada');
-- edição pelo planejamento enquanto a rota não foi encerrada (execução e aprovação só pelas funções)
create policy rotas_update on public.rotas for update to authenticated
  using ((select public.tem_permissao('rotas.definir')) and status in ('planejada', 'em_andamento'))
  with check ((select public.tem_permissao('rotas.definir')) and status in ('planejada', 'em_andamento', 'cancelada'));

create policy paradas_select on public.rota_paradas for select to authenticated
  using (exists (select 1 from public.rotas r where r.id = rota_id));
create policy paradas_insert on public.rota_paradas for insert to authenticated
  with check ((select public.tem_permissao('rotas.definir')) and exists (select 1 from public.rotas r where r.id = rota_id and r.status in ('planejada', 'em_andamento')));
create policy paradas_update on public.rota_paradas for update to authenticated
  using ((select public.tem_permissao('rotas.definir')) and exists (select 1 from public.rotas r where r.id = rota_id and r.status in ('planejada', 'em_andamento')));
create policy paradas_delete on public.rota_paradas for delete to authenticated
  using ((select public.tem_permissao('rotas.definir')) and status = 'pendente' and exists (select 1 from public.rotas r where r.id = rota_id and r.status = 'planejada'));

-- check-ins: só leitura pela API (gravação pela função registrar_checkin)
create policy checkins_select on public.checkins for select to authenticated using (public.pode_ver_rota(consultor_id));

create policy despesas_select on public.despesas_rota for select to authenticated using (public.pode_ver_rota(consultor_id));
create policy despesas_insert on public.despesas_rota for insert to authenticated
  with check ((select public.tem_permissao('despesas.lancar')) and consultor_id = (select auth.uid()) and status = 'lancada'
              and (rota_id is null or exists (select 1 from public.rotas r where r.id = rota_id and r.consultor_id = (select auth.uid()))));
create policy despesas_update on public.despesas_rota for update to authenticated
  using (consultor_id = (select auth.uid()) and status = 'lancada') with check (consultor_id = (select auth.uid()) and status = 'lancada');
create policy despesas_delete on public.despesas_rota for delete to authenticated using (consultor_id = (select auth.uid()) and status = 'lancada');

do $$
declare t text;
begin
  foreach t in array array['veiculos', 'rotas', 'rota_paradas', 'checkins', 'despesas_rota'] loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (empresa_id = (select public.empresa_atual())) with check (empresa_id = (select public.empresa_atual()))', t || '_empresa', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Storage: fotos de hodômetro, selfies e comprovantes em empresas/<id>/rotas/<rota>/...
-- ---------------------------------------------------------------------
create or replace function public.storage_can_access(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_rel text := public.storage_caminho_relativo(p_name); v_parts text[]; v_id uuid;
begin
  if v_rel is null or not public.is_active_user() then return false; end if;
  v_parts := string_to_array(v_rel, '/');
  if v_parts[1] in ('clientes', 'processos', 'rotas', 'despesas') and array_length(v_parts, 1) >= 3 then
    begin v_id := v_parts[2]::uuid; exception when others then return false; end;
    return case v_parts[1]
      when 'clientes' then public.can_access_cliente(v_id)
      when 'processos' then public.can_access_processo(v_id)
      when 'rotas' then exists (select 1 from public.rotas r where r.id = v_id and r.empresa_id = public.empresa_atual() and public.pode_ver_rota(r.consultor_id))
      else v_id = auth.uid() or public.tem_permissao('despesas.aprovar') or public.is_supervisor_de(v_id) -- despesas/<consultor>/...
    end;
  elsif v_parts[1] = 'geral' then
    return public.is_backoffice();
  end if;
  return false;
end $$;
