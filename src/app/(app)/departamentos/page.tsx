import type { Metadata } from "next";
import { AlarmClock, Building2, Gavel, Scale, Star, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { getProfileMap, userOptions } from "@/lib/data";
import { num, todayISO } from "@/lib/format";
import type { Departamento, DepartamentoMembro } from "@/lib/types";
import { createDepartamento } from "@/lib/actions/departamentos";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, spStartOf } from "@/components/dashboard/periods";
import { DepartamentoCard, type DepCardData } from "@/components/departamentos/departamento-card";
import { departamentoFields } from "@/components/departamentos/fields";

export const metadata: Metadata = { title: "Departamentos" };

interface DepRef { departamento_id: string | null }
interface PrazoRow extends DepRef { data_fim: string }
type ProcRef = { departamento_id: string | null } | { departamento_id: string | null }[] | null;
interface AudRow { processos: ProcRef }

const depOfProc = (p: ProcRef) => (Array.isArray(p) ? p[0]?.departamento_id : p?.departamento_id) ?? null;

function countBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export default async function DepartamentosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("departamentos.view");
  const sp = await searchParams;
  const manager = isManagerRole(profile.role);
  const supabase = await createClient();
  const today = todayISO();
  const nowIso = new Date().toISOString();
  const in7Iso = new Date(spStartOf(addDays(today, 8))).toISOString();

  const [depsRes, membrosRes, processos, prazos, audienciasRes, tarefas, profiles, users] = await Promise.all([
    supabase.from("departamentos").select("id, nome, sigla, descricao, cor, responsavel_id, ativo").order("nome"),
    supabase.from("departamento_membros").select("departamento_id, user_id, funcao"),
    fetchAll<DepRef>((f, t) => supabase.from("processos").select("departamento_id").not("departamento_id", "is", null).in("status", ["ativo", "suspenso"]).order("id").range(f, t)),
    fetchAll<PrazoRow>((f, t) => supabase.from("prazos").select("departamento_id, data_fim").not("departamento_id", "is", null).eq("status", "pendente").order("id").range(f, t)),
    supabase.from("audiencias").select("processos!inner(departamento_id)").in("status", ["agendada", "redesignada"]).gte("data_hora", nowIso).lt("data_hora", in7Iso).limit(2000),
    fetchAll<DepRef>((f, t) => supabase.from("tarefas").select("departamento_id").not("departamento_id", "is", null).neq("status", "concluida").order("id").range(f, t)),
    getProfileMap(),
    manager ? userOptions() : Promise.resolve([]),
  ]);

  const deps = ((depsRes.data ?? []) as Departamento[]).filter((d) => manager || d.ativo);
  const membros = (membrosRes.data ?? []) as DepartamentoMembro[];
  const audiencias = (audienciasRes.data ?? []) as unknown as AudRow[];

  const procBy = countBy(processos, (r) => r.departamento_id);
  const prazoBy = countBy(prazos, (r) => r.departamento_id);
  const vencBy = countBy(
    prazos.filter((p) => p.data_fim < today),
    (r) => r.departamento_id,
  );
  const audBy = countBy(audiencias, (r) => depOfProc(r.processos));
  const tarBy = countBy(tarefas, (r) => r.departamento_id);

  const cards: DepCardData[] = deps.map((d) => {
    const ms = membros.filter((m) => m.departamento_id === d.id);
    const resp = d.responsavel_id ? profiles.get(d.responsavel_id) : undefined;
    const meu = d.responsavel_id === userId || ms.some((m) => m.user_id === userId);
    return {
      id: d.id,
      nome: d.nome,
      sigla: d.sigla,
      descricao: d.descricao,
      cor: d.cor,
      ativo: d.ativo,
      meu,
      responsavel: resp ? { nome: resp.full_name || resp.email, avatar: resp.avatar_url } : null,
      membros: ms
        .sort((a, b) => Number(b.funcao === "responsavel") - Number(a.funcao === "responsavel"))
        .map((m) => {
          const p = profiles.get(m.user_id);
          return { id: m.user_id, nome: p?.full_name || p?.email || "Usuário", avatar: p?.avatar_url ?? null };
        }),
      processos: procBy.get(d.id) ?? 0,
      prazos: prazoBy.get(d.id) ?? 0,
      vencidos: vencBy.get(d.id) ?? 0,
      audiencias: audBy.get(d.id) ?? 0,
      demandas: tarBy.get(d.id) ?? 0,
    };
  });

  const ativos = cards.filter((c) => c.ativo);
  const meus = cards.filter((c) => c.meu && c.ativo);
  const outros = cards.filter((c) => !(c.meu && c.ativo) && c.ativo);
  const inativos = cards.filter((c) => !c.ativo);
  const pessoas = new Set(membros.filter((m) => ativos.some((c) => c.id === m.departamento_id)).map((m) => m.user_id)).size;
  const totVencidos = ativos.reduce((a, c) => a + c.vencidos, 0);

  const grid = (list: DepCardData[]) => (
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {list.map((d) => (
        <DepartamentoCard key={d.id} d={d} />
      ))}
    </div>
  );

  return (
    <>
      <PageHeader
        eyebrow="Gestão"
        title="Departamentos"
        description="Equipes, carteiras de processos, prazos e demandas por área de atuação."
        actions={
          manager ? (
            <FormDrawerButton
              action={createDepartamento}
              fields={departamentoFields(users)}
              values={{ cor: "brand" }}
              title="Novo departamento"
              label="Novo departamento"
              variant="accent"
              width="max-w-lg"
              submitLabel="Criar departamento"
              redirectTo="/departamentos/:id"
              defaultOpen={sp.novo === "1"}
            />
          ) : undefined
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Departamentos ativos" value={num(ativos.length)} icon={<Building2 className="h-5 w-5" />} hint={`${num(pessoas)} pessoa(s) nas equipes`} />
        <StatCard label="Processos em andamento" value={num(ativos.reduce((a, c) => a + c.processos, 0))} icon={<Scale className="h-5 w-5" />} hint="ativos e suspensos" />
        <StatCard
          label="Prazos pendentes"
          value={num(ativos.reduce((a, c) => a + c.prazos, 0))}
          icon={<AlarmClock className="h-5 w-5" />}
          tone={totVencidos ? "accent" : "green"}
          hint={totVencidos ? <span className="font-semibold text-red-600 dark:text-red-400">{num(totVencidos)} vencido(s) sem baixa</span> : "nenhum vencido"}
        />
        <StatCard label="Audiências em 7 dias" value={num(ativos.reduce((a, c) => a + c.audiencias, 0))} icon={<Gavel className="h-5 w-5" />} tone="amber" hint="agendadas" />
      </div>

      {cards.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Building2 className="h-6 w-6" />} title="Nenhum departamento cadastrado" description="Crie departamentos para organizar equipes, processos e demandas." />
        </div>
      ) : manager ? (
        <>
          {grid(ativos)}
          {inativos.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Inativos</h2>
              {grid(inativos)}
            </section>
          )}
        </>
      ) : (
        <>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-accent-600">
              <Star className="h-4 w-4" /> Meus departamentos
            </h2>
            {meus.length ? (
              grid(meus)
            ) : (
              <div className="card">
                <EmptyState icon={<Users className="h-6 w-6" />} title="Você ainda não faz parte de um departamento" description="Peça à gestão ou ao responsável da área para incluir você na equipe." />
              </div>
            )}
          </section>
          {outros.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Outros departamentos</h2>
              {grid(outros)}
            </section>
          )}
        </>
      )}
      <p className="mt-6 text-xs text-muted">Os indicadores consideram os registros que você tem permissão para ver.</p>
    </>
  );
}
