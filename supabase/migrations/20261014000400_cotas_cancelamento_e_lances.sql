-- 1) Data de cancelamento da cota (relatórios de cancelamento precisos)
alter table public.consorcio_cotas add column if not exists cancelada_em date;

create or replace function public.cota_cancelamento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status is distinct from 'cancelada') then
    new.cancelada_em := coalesce(new.cancelada_em, (now() at time zone 'America/Sao_Paulo')::date);
  elsif new.status <> 'cancelada' then
    new.cancelada_em := null;
  end if;
  return new;
end $$;
revoke execute on function public.cota_cancelamento() from public, anon, authenticated;
create trigger trg_cota_cancelamento before insert or update of status on public.consorcio_cotas
  for each row execute function public.cota_cancelamento();

update public.consorcio_cotas set cancelada_em = updated_at::date where status = 'cancelada' and cancelada_em is null;

-- 2) Lance deixa de ser "contemplado" (correção de lançamento) => desfaz a contemplação
--    da cota, desde que ela tenha sido contemplada por esse mesmo lance.
create or replace function public.lance_contempla_cota()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.resultado = 'contemplado' and (tg_op = 'INSERT' or old.resultado is distinct from new.resultado) then
    update public.consorcio_cotas
       set status = 'contemplada', contemplada_em = new.data_assembleia,
           forma_contemplacao = new.tipo, valor_lance = new.valor
     where id = new.cota_id;
  elsif tg_op = 'UPDATE' and old.resultado = 'contemplado' and new.resultado <> 'contemplado' then
    update public.consorcio_cotas
       set status = 'ativa', contemplada_em = null, forma_contemplacao = null, valor_lance = null
     where id = new.cota_id and status = 'contemplada' and contemplada_em = old.data_assembleia
       and not exists (select 1 from public.consorcio_lances l where l.cota_id = new.cota_id and l.id <> new.id and l.resultado = 'contemplado');
  end if;
  return new;
end $$;
