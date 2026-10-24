import { AlertTriangle, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { hasServiceRole } from "@/lib/supabase/admin";
import { ROLES } from "@/lib/constants";
import { date, pct } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { criarUsuario, definirSenhaUsuario, updateUsuario } from "@/lib/actions/usuarios";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { editUsuarioFields, novoUsuarioFields, senhaUsuarioFields } from "./usuario-fields";

export async function UsuariosTab({ currentUserId, isMaster }: { currentUserId: string; isMaster: boolean }) {
  const supabase = await createClient();
  const [{ data }, { data: niveis }] = await Promise.all([
    supabase.from("membros").select("*").order("full_name"),
    isMaster ? supabase.from("departamento_niveis").select("id, nome, departamentos(nome)").order("ordem") : Promise.resolve({ data: [] }),
  ]);
  const opNiveis = ((niveis ?? []) as unknown as { id: string; nome: string; departamentos: { nome: string } | null }[])
    .map((n) => ({ value: n.id, label: `${n.departamentos?.nome ?? "Departamento"} · ${n.nome}` }))
    .sort((x, y) => x.label.localeCompare(y.label, "pt-BR"));
  const users = ((data ?? []) as Profile[]).sort((a, b) => Number(a.active) - Number(b.active));
  const pending = users.filter((u) => !u.active).length;
  const serviceRole = hasServiceRole();

  return (
    <div className="space-y-6">
      {!serviceRole && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Criação de usuários desativada</p>
            <p className="mt-1">
              Configure <code className="font-mono text-xs">SUPABASE_SERVICE_ROLE_KEY</code> no servidor para criar usuários e definir senhas. Enquanto isso, quem se cadastrar sozinho aparece aqui como <b>inativo</b>, aguardando sua aprovação.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader
          title="Usuários"
          description={`${users.length} usuário(s)${pending ? ` · ${pending} aguardando aprovação` : ""}`}
          icon={<Users className="h-4 w-4" />}
          action={serviceRole && <FormDrawerButton action={criarUsuario} fields={novoUsuarioFields(opNiveis)} values={{ role: "administrativo", comissao_percentual: 0, trocar_senha: true }} title="Novo usuário" label="Novo usuário" variant="accent" size="sm" width="max-w-lg" submitLabel="Criar acesso" description="O acesso é criado na hora, sem e-mail: passe o login e a senha para a pessoa." />}
        />
        {users.length === 0 ? (
          <EmptyState title="Nenhum usuário" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Papel</th>
                  <th>Status</th>
                  <th>Comissão</th>
                  <th>Território</th>
                  <th>Desde</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={!u.active ? "bg-amber-50/40 dark:bg-amber-950/10" : undefined}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.full_name} src={u.avatar_url} size={36} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">
                            {u.full_name || "—"}
                            {u.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-muted">(você)</span>}
                          </span>
                          <span className="block truncate text-xs text-muted">{u.email}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge options={ROLES} value={u.role} />
                        {(u.admin_master || u.is_master) && <Badge tone="accent">Master</Badge>}
                      </div>
                    </td>
                    <td>{u.active ? <Badge tone="green" dot>Ativo</Badge> : <Badge tone="amber" dot>Aguardando aprovação</Badge>}</td>
                    <td className="text-sm">{pct(u.comissao_percentual, 2)}</td>
                    <td className="text-sm">{u.territorio ?? <span className="text-muted">—</span>}</td>
                    <td className="text-xs text-muted">{date(u.created_at)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {(!u.is_master || u.id === currentUserId) && <FormDrawerButton
                          action={updateUsuario}
                          fields={editUsuarioFields}
                          values={{ role: u.role, active: u.active, comissao_percentual: u.comissao_percentual, territorio: u.territorio, cargo: u.cargo }}
                          hidden={{ id: u.id }}
                          title={u.active ? `Editar ${u.full_name || u.email}` : `Aprovar ${u.full_name || u.email}`}
                          description={u.id === currentUserId ? "Você não pode remover seu próprio acesso de administrador." : u.email}
                          icon="edit"
                          size="icon"
                          variant="ghost"
                          width="max-w-lg"
                        />}
                        {serviceRole && u.id !== currentUserId && (!(u.admin_master || u.role === "admin" || u.role === "gestor") || isMaster) && (
                          <FormDrawerButton
                            action={definirSenhaUsuario}
                            fields={senhaUsuarioFields}
                            values={{ trocar_senha: true }}
                            hidden={{ id: u.id }}
                            title={`Definir senha: ${u.full_name || u.email}`}
                            description={`Login: ${u.email}`}
                            label="Definir senha"
                            icon="key"
                            size="icon"
                            variant="ghost"
                            width="max-w-md"
                            submitLabel="Salvar senha"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
