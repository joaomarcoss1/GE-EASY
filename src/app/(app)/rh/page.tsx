import type { Metadata } from "next";
import { IdCard, KeyRound, UserCog, Users } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { ROLES } from "@/lib/constants";
import { date } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "RH — Funcionários e acessos" };

/** Entrada do RH: equipe da empresa com departamentos, níveis e situação do acesso (somente leitura). */
export default async function RhPage() {
  const { profile } = await requireArea("rh");
  const supabase = await createClient();
  const [{ data: membros }, { data: vinculos }, { data: deps }, { data: niveis }] = await Promise.all([
    supabase.from("membros").select("*").order("full_name"),
    supabase.from("departamento_membros").select("departamento_id, user_id, nivel_id, ativo, valido_ate"),
    supabase.from("departamentos").select("id, nome, sigla, tipo").eq("ativo", true),
    supabase.from("departamento_niveis").select("id, nome"),
  ]);
  const pessoas = (membros ?? []) as Profile[];
  const depNome = new Map((deps ?? []).map((d) => [d.id as string, (d.sigla as string) || (d.nome as string)]));
  const nivelNome = new Map((niveis ?? []).map((n) => [n.id as string, n.nome as string]));
  const porUsuario = new Map<string, { dep: string; nivel: string | null; ativo: boolean }[]>();
  for (const v of vinculos ?? []) {
    if (!depNome.has(v.departamento_id)) continue;
    const l = porUsuario.get(v.user_id) ?? [];
    l.push({ dep: depNome.get(v.departamento_id)!, nivel: v.nivel_id ? (nivelNome.get(v.nivel_id) ?? null) : null, ativo: v.ativo && (!v.valido_ate || v.valido_ate >= new Date().toISOString().slice(0, 10)) });
    porUsuario.set(v.user_id, l);
  }
  const ativos = pessoas.filter((p) => p.active).length;

  return (
    <>
      <PageHeader
        eyebrow="Recursos Humanos"
        title="Funcionários e acessos"
        description="Quem trabalha na empresa, em quais departamentos e com qual nível de acesso."
        actions={
          <>
            {profile.admin_master && <LinkButton href="/acessos" variant="accent"><KeyRound className="h-4 w-4" />Gerir acessos</LinkButton>}
            {can(profile, "usuarios.manage") && <LinkButton href="/configuracoes?tab=usuarios" variant="secondary"><UserCog className="h-4 w-4" />Usuários e convites</LinkButton>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Usuários ativos" value={ativos} icon={<Users className="h-5 w-5" />} tone="green" />
        <StatCard label="Acessos desativados" value={pessoas.length - ativos} icon={<IdCard className="h-5 w-5" />} tone="amber" />
        <StatCard label="Departamentos" value={(deps ?? []).length} icon={<IdCard className="h-5 w-5" />} />
      </div>
      <Card>
        <CardHeader title="Equipe" description="Ponto, jornada e pré-folha chegam na fase 7 do roadmap" />
        {pessoas.length === 0 ? <EmptyState title="Nenhum usuário" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Funcionário</th><th>Perfil</th><th>Departamentos e níveis</th><th>Situação</th><th>Desde</th></tr></thead>
              <tbody>
                {pessoas.map((p) => (
                  <tr key={p.id}>
                    <td><div className="flex items-center gap-3"><Avatar name={p.full_name} src={p.avatar_url} size={34} /><span><span className="block font-medium">{p.full_name || p.email}</span><span className="block text-xs text-muted">{p.cargo ?? p.email}</span></span></div></td>
                    <td><div className="flex flex-wrap gap-1"><StatusBadge options={ROLES} value={p.role} />{p.admin_master && <Badge tone="accent">Master</Badge>}</div></td>
                    <td><div className="flex flex-wrap gap-1">{(porUsuario.get(p.id) ?? []).map((v, i) => <Badge key={i} tone={v.ativo ? "brand" : "slate"}>{v.dep}{v.nivel ? ` · ${v.nivel}` : ""}</Badge>)}{!porUsuario.get(p.id)?.length && <span className="text-xs text-muted">—</span>}</div></td>
                    <td>{p.active ? <Badge tone="green">Ativo</Badge> : <Badge tone="amber">Desativado</Badge>}</td>
                    <td className="text-xs text-muted">{date(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
