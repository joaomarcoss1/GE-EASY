import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarCheck, Clock, FileSpreadsheet, IdCard, KeyRound, UserCog, Users } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { departamentoOptions, searchTerm } from "@/lib/data";
import { FUNCIONARIO_STATUS, ROLES, TIPOS_CONTRATO, toMap } from "@/lib/constants";
import { date } from "@/lib/format";
import { desligarFuncionario } from "@/lib/actions/acessos";
import { salvarFuncionario } from "@/lib/actions/rh";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { FilterSelect, SearchInput } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";
import { camposFuncionario } from "@/components/rh/campos";

export const metadata: Metadata = { title: "RH — Funcionários" };

const contratos = toMap(TIPOS_CONTRATO);


/** Entrada do RH: funcionários (com ou sem acesso ao sistema), admissão, desligamento, ponto e pré-folha. */
export default async function RhPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireArea("rh");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("funcionarios").select("id, nome, matricula, cargo, departamento_id, jornada_id, tipo_contrato, admissao, status, user_id, ponto_externo").order("nome").limit(500);
  if (sp.status && FUNCIONARIO_STATUS.some((s) => s.value === sp.status)) q = q.eq("status", sp.status);
  else if (!sp.status) q = q.neq("status", "desligado");
  const termo = searchTerm(sp.q);
  if (termo) q = q.or(`nome.ilike.%${termo}%,matricula.ilike.%${termo}%,cargo.ilike.%${termo}%`);
  const [{ data: funcs }, deps, { data: jornadas }, { data: membros }, { count: pendentes }] = await Promise.all([
    q, departamentoOptions(), supabase.from("jornadas").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("membros").select("id, full_name, email, active, is_master"),
    supabase.from("ponto_ajustes").select("id", { count: "exact", head: true }).eq("status", "pendente"),
  ]);
  const lista = funcs ?? [];
  const depNome = new Map(deps.map((d) => [d.value, d.label]));
  const opJor = (jornadas ?? []).map((j) => ({ value: j.id as string, label: j.nome as string }));
  const jorNome = new Map(opJor.map((j) => [j.value, j.label]));
  const membro = new Map((membros ?? []).map((m) => [m.id as string, m]));
  const edita = can(profile, "rh.funcionarios.editar");
  const podeDesligar = profile.admin_master || can(profile, "usuarios.manage");
  const destinos = (membros ?? []).filter((m) => m.active).map((m) => ({ value: m.id as string, label: (m.full_name as string) || (m.email as string) }));
  const ativos = lista.filter((f) => f.status === "ativo").length;

  return (
    <>
      <PageHeader eyebrow="Recursos Humanos" title="Funcionários" description="Cadastro, contrato, jornada, ponto e pré-folha. Salários, dados bancários e atestados só para quem tem a permissão de dados sensíveis."
        actions={
          <>
            {edita && (
              <FormDrawerButton action={salvarFuncionario} title="Admitir funcionário" label="Admitir" variant="accent" width="max-w-2xl" values={{ tipo_contrato: "clt", controla_ponto: true, role: "administrativo", trocar_senha: true }}
                fields={[...camposFuncionario(deps, opJor), ...(can(profile, "usuarios.manage") ? [
                  { name: "criar_acesso", label: "Criar acesso ao sistema (login = e-mail)", type: "checkbox", span: 3, section: "Acesso" } as FieldDef,
                  { name: "role", label: "Perfil de acesso", type: "select", options: ROLES.filter((r) => !["admin", "gestor"].includes(r.value)), span: 3 } as FieldDef,
                  { name: "senha", label: "Senha inicial", type: "password", span: 3, help: "Mínimo de 10 caracteres, com maiúscula, minúscula e número" } as FieldDef,
                  { name: "confirmar", label: "Confirmar senha", type: "password", span: 3 } as FieldDef,
                  { name: "trocar_senha", label: "Pedir para trocar a senha no primeiro acesso", type: "checkbox", span: 6 } as FieldDef,
                ] : [])]} />
            )}
            {can(profile, "ponto.gerir") && <LinkButton href="/ponto?tab=aprovacoes" variant="secondary"><Clock className="h-4 w-4" />Ponto{pendentes ? ` (${pendentes})` : ""}</LinkButton>}
            {can(profile, "folha.gerir") && <LinkButton href="/rh/folha" variant="secondary"><FileSpreadsheet className="h-4 w-4" />Pré-folha</LinkButton>}
            {profile.admin_master && <LinkButton href="/acessos" variant="secondary"><KeyRound className="h-4 w-4" />Acessos</LinkButton>}
            {can(profile, "usuarios.manage") && <LinkButton href="/configuracoes?tab=usuarios" variant="ghost"><UserCog className="h-4 w-4" />Usuários</LinkButton>}
          </>
        } />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Ativos" value={ativos} icon={<Users className="h-5 w-5" />} tone="green" />
        <StatCard label="Férias / afastados" value={lista.filter((f) => ["ferias", "afastado"].includes(f.status)).length} icon={<CalendarCheck className="h-5 w-5" />} tone="amber" />
        <StatCard label="Sem acesso ao sistema" value={lista.filter((f) => !f.user_id).length} icon={<IdCard className="h-5 w-5" />} />
      </div>
      <Card>
        <CardHeader title="Equipe" description="Desligar transfere carteira, tarefas, leads e conversas, revoga os aparelhos e encerra o acesso — tudo auditado." />
        <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row">
          <Suspense>
            <SearchInput placeholder="Nome, matrícula ou cargo" />
            <FilterSelect param="status" options={FUNCIONARIO_STATUS} allLabel="Todos exceto desligados" />
          </Suspense>
        </div>
        {lista.length === 0 ? <EmptyState title="Nenhum funcionário" /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Funcionário</th><th>Departamento</th><th>Contrato</th><th>Jornada</th><th>Admissão</th><th>Situação</th><th /></tr></thead>
            <tbody>{lista.map((f) => {
              const m = f.user_id ? membro.get(f.user_id) : null;
              return (
                <tr key={f.id}>
                  <td><Link href={`/rh/${f.id}`} className="font-medium hover:text-brand-600">{f.nome}</Link><p className="text-xs text-muted">{[f.matricula, f.cargo, f.user_id ? "com acesso" : "sem acesso"].filter(Boolean).join(" · ")}</p></td>
                  <td className="text-sm">{f.departamento_id ? depNome.get(f.departamento_id) ?? "—" : "—"}</td>
                  <td className="text-sm">{contratos[f.tipo_contrato]?.label}</td>
                  <td className="text-sm">{f.jornada_id ? jorNome.get(f.jornada_id) : <span className="text-amber-600">sem jornada</span>}{f.ponto_externo && <span className="block text-xs text-muted">externo</span>}</td>
                  <td className="text-sm">{date(f.admissao)}</td>
                  <td><StatusBadge options={FUNCIONARIO_STATUS} value={f.status} /></td>
                  <td className="text-right">
                    {podeDesligar && m?.active && f.user_id !== userId && !m.is_master && (
                      <FormDrawerButton action={desligarFuncionario} hidden={{ user_id: f.user_id }} title={`Desligar ${f.nome}`} label="Desligar" icon="none" size="sm" variant="ghost" width="max-w-md" submitLabel="Confirmar desligamento"
                        description="O acesso termina na hora. Clientes, tarefas, negócios, leads e conversas vão para quem você escolher (ou para a base administrativa)."
                        fields={[
                          { name: "destino", label: "Transferir para", type: "select", options: destinos.filter((d) => d.value !== f.user_id), emptyOption: "Base administrativa (sem consultor)", span: 6 },
                          { name: "motivo", label: "Motivo", type: "textarea", rows: 3, required: true, span: 6 },
                        ]} />
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
