-- Fichas de pendências e de exigências viram funcionalidades próprias, para o administrador liberar ou bloquear
-- por pessoa (tela /acessos › Por usuário) ou por nível. Antes, qualquer um com processos.status_restritos
-- abria os dois tipos de ficha.
insert into public.funcionalidades (chave, nome, area, sensivel, ordem)
values ('fichas.pendencias', 'Fichas de pendências (abrir, anotar e encaminhar)', 'administrativo', false, 35),
       ('fichas.exigencias', 'Fichas de exigências (abrir, anotar e encaminhar)', 'administrativo', false, 36)
on conflict (chave) do update set nome = excluded.nome, area = excluded.area, sensivel = excluded.sensivel, ordem = excluded.ordem;

-- Padrão por nível: todos os níveis do setor Pendências → fichas de pendências; do setor Exigências → fichas de
-- exigências; o nível Gestor de qualquer setor administrativo → as duas.
insert into public.nivel_funcionalidades (nivel_id, funcionalidade, empresa_id)
select n.id, x.f, n.empresa_id
  from public.departamento_niveis n
  join public.departamentos d on d.id = n.departamento_id and d.tipo = 'administrativo'
  cross join lateral (values ('fichas.pendencias'), ('fichas.exigencias')) x(f)
 where (d.nome = 'Pendências' and x.f = 'fichas.pendencias')
    or (d.nome = 'Exigências' and x.f = 'fichas.exigencias')
    or n.nome = 'Gestor'
on conflict do nothing;

insert into public.funcionalidades_padrao (tipo, nivel, ordem, funcionalidade)
select 'administrativo', 'Gestor', 99, f from (values ('fichas.pendencias'), ('fichas.exigencias')) x(f)
on conflict do nothing;

-- A gerente administrativa (Vanuza) já recebe os setores por exceção: as duas fichas também.
insert into public.usuario_permissoes_extra (empresa_id, user_id, funcionalidade, tipo, motivo)
select e.empresa_id, e.user_id, x.f, 'concessao', 'Gerente administrativa: fichas de pendências e de exigências'
  from public.usuario_permissoes_extra e
  cross join (values ('fichas.pendencias'), ('fichas.exigencias')) x(f)
 where e.funcionalidade = 'processos.status_restritos' and e.tipo = 'concessao'
   and e.motivo like 'Gerente administrativa%'
on conflict do nothing;

-- Banco: abrir/editar a ficha e anotar exigem a funcionalidade do tipo da ficha.
drop policy fichas_pendencia_insert on public.fichas_pendencia;
create policy fichas_pendencia_insert on public.fichas_pendencia for insert to authenticated
  with check ((select public.tem_permissao('clientes.write'))
              and ((tipo = 'pendencia' and (select public.tem_permissao('fichas.pendencias')))
                   or (tipo = 'exigencia' and (select public.tem_permissao('fichas.exigencias')))));
drop policy fichas_pendencia_update on public.fichas_pendencia;
create policy fichas_pendencia_update on public.fichas_pendencia for update to authenticated
  using ((select public.tem_permissao('clientes.write'))
         and ((tipo = 'pendencia' and (select public.tem_permissao('fichas.pendencias')))
              or (tipo = 'exigencia' and (select public.tem_permissao('fichas.exigencias')))))
  with check ((select public.tem_permissao('clientes.write'))
              and ((tipo = 'pendencia' and (select public.tem_permissao('fichas.pendencias')))
                   or (tipo = 'exigencia' and (select public.tem_permissao('fichas.exigencias')))));

drop policy ficha_itens_insert on public.ficha_pendencia_itens;
create policy ficha_itens_insert on public.ficha_pendencia_itens for insert to authenticated
  with check (criado_por = (select auth.uid()) and (select public.tem_permissao('clientes.write'))
              and exists (select 1 from public.fichas_pendencia f where f.id = ficha_id
                            and ((f.tipo = 'pendencia' and (select public.tem_permissao('fichas.pendencias')))
                                 or (f.tipo = 'exigencia' and (select public.tem_permissao('fichas.exigencias'))))));
drop policy ficha_itens_update on public.ficha_pendencia_itens;
create policy ficha_itens_update on public.ficha_pendencia_itens for update to authenticated
  using ((select public.tem_permissao('clientes.write'))
         and exists (select 1 from public.fichas_pendencia f where f.id = ficha_id
                       and ((f.tipo = 'pendencia' and (select public.tem_permissao('fichas.pendencias')))
                            or (f.tipo = 'exigencia' and (select public.tem_permissao('fichas.exigencias'))))))
  with check ((select public.tem_permissao('clientes.write')));
