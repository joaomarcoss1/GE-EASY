import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLES } from "@/lib/constants";
import { csvResponse, toCsv } from "@/lib/csv";
import { registrarAcesso } from "@/lib/actions/utils";

export const dynamic = "force-dynamic";

/** Matriz de acessos (funcionário × departamento × nível) em CSV — somente o administrador master; auditado. */
export async function GET() {
  const session = await getSession();
  if (!session?.empresa || !session.profile.active) return new Response("Não autorizado", { status: 401 });
  if (!session.profile.admin_master) return new Response("Sem permissão", { status: 403 });
  const supabase = await createClient();
  const [{ data: membros }, { data: deps }, { data: niveis }, { data: vinculos }, { data: extras }] = await Promise.all([
    supabase.from("membros").select("id, full_name, email, role, active, admin_master").order("full_name"),
    supabase.from("departamentos").select("id, nome, sigla").eq("ativo", true).order("nome"),
    supabase.from("departamento_niveis").select("id, nome"),
    supabase.from("departamento_membros").select("departamento_id, user_id, nivel_id, ativo, valido_ate"),
    supabase.from("usuario_permissoes_extra").select("user_id, funcionalidade, tipo"),
  ]);
  const nivel = new Map((niveis ?? []).map((n) => [n.id as string, n.nome as string]));
  const depsL = deps ?? [];
  const linhas = (membros ?? []).map((m) => {
    const v = (vinculos ?? []).filter((x) => x.user_id === m.id);
    const ex = (extras ?? []).filter((x) => x.user_id === m.id);
    return [
      m.full_name || m.email,
      m.email,
      ROLES.find((r) => r.value === m.role)?.label ?? m.role,
      m.active ? "Sim" : "Não",
      m.admin_master ? "Sim" : "Não",
      ...depsL.map((d) => {
        const x = v.find((y) => y.departamento_id === d.id);
        return x ? `${x.nivel_id ? (nivel.get(x.nivel_id) ?? "") : "membro"}${x.ativo ? "" : " (inativo)"}${x.valido_ate ? ` até ${x.valido_ate}` : ""}` : "";
      }),
      ex.filter((e) => e.tipo === "concessao").map((e) => e.funcionalidade).join(", "),
      ex.filter((e) => e.tipo === "revogacao").map((e) => e.funcionalidade).join(", "),
    ];
  });
  await registrarAcesso("EXPORTACAO", "acessos", null, { linhas: linhas.length });
  return csvResponse(`acessos-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
    ["Funcionário", "E-mail", "Perfil", "Ativo", "Master", ...depsL.map((d) => (d.sigla as string) || (d.nome as string)), "Concessões", "Revogações"],
    linhas,
  ));
}
