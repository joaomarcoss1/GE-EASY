-- Corrige registrar_andamento_sistema: a condição "tg_table_name = 'prazos' and new.processo_id ..."
-- avaliava new.processo_id também na tabela processos (que não tem a coluna) e quebrava o UPDATE.
create or replace function public.registrar_andamento_sistema()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_msg text; v_proc uuid; v_tipo public.andamento_tipo := 'outro';
begin
  if tg_table_name = 'audiencias' then
    v_proc := new.processo_id; v_tipo := 'audiencia';
    if tg_op = 'INSERT' then v_msg := 'Audiência (' || new.tipo || ') agendada para ' || to_char(new.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    elsif old.status is distinct from new.status then v_msg := 'Audiência de ' || to_char(new.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ': ' || new.status || coalesce(' — ' || new.resultado, '');
    elsif old.data_hora is distinct from new.data_hora then v_msg := 'Audiência redesignada para ' || to_char(new.data_hora at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    end if;
  elsif tg_table_name = 'prazos' then
    v_proc := new.processo_id;
    if v_proc is not null then
      if tg_op = 'INSERT' then v_msg := 'Prazo cadastrado: ' || new.descricao || ' (vence ' || to_char(new.data_fim, 'DD/MM/YYYY') || ')';
      elsif old.status is distinct from new.status then v_msg := 'Prazo "' || new.descricao || '": ' || new.status;
      end if;
    end if;
  elsif tg_table_name = 'processos' then
    v_proc := new.id;
    if tg_op = 'UPDATE' then
      if old.fase is distinct from new.fase then v_msg := 'Fase alterada para ' || new.fase;
      elsif old.status is distinct from new.status then v_msg := 'Situação alterada para ' || new.status;
      end if;
    end if;
  end if;
  if v_msg is not null and v_proc is not null then
    insert into public.processo_andamentos (processo_id, tipo, descricao, autor_id) values (v_proc, v_tipo, v_msg, auth.uid());
  end if;
  return new;
end $$;
revoke execute on function public.registrar_andamento_sistema() from public, anon, authenticated;
