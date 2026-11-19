import Link from "next/link";
import { AlarmClock, CalendarPlus, ClipboardList, FolderSearch, ListPlus, ShieldAlert, Target, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/auth";
import { CASO_STATUS, CASO_STATUS_RESTRITOS } from "@/lib/constants";
import { date, daysUntil, num, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { MetaProgresso, type MetaLinha } from "@/components/metas/metas-processos";
import { carregarInconsistencias } from "@/lib/inconsistencias";
import { ExigenciaPrazo } from "@/components/processos/exigencia-prazo";
import { AgendaCard, CustasResumoCard, greeting, MinhasTarefasCard, todayLong } from "@/components/juridico/dashboard-widgets";

const linkCls = "text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300";
const TONS: Record<string, string> = {
  em_analise: "bg-sky-500", pendencia: "bg-amber-500", exigencia: "bg-red-500", habilitado: "bg-emerald-500",
  deferido: "bg-green-600", indeferido: "bg-rose-600", aguardando_idade: "bg-brand-500", judicializado: "bg-violet-500",
  arquivo_morto: "bg-slate-400", outros: "bg-slate-300",
};

interface Exigencia {
  id: string;
  cliente_id: string;
  tipo: string;
  exigencia_prazo: string | null;
  exigencia_prorrogada: boolean;
  clientes: { nome: string } | { nome: string }[] | null;
}

/** Painel principal: processos, prazos (exigências e documentação), metas do mês, reuniões e tarefas. */
export async function PainelEscritorio({ session, firstName, alert }: { session: Session; firstName: string; alert: React.ReactNode }) {
  const { profile, userId } = session;
  const supabase = await createClient();
  const veClientes = can(profile, "clientes.view");
  const veBase = can(profile, "clientes.ver_todos");
  const podeEditar = can(profile, "clientes.write");
  const podeRestritos = can(profile, "processos.status_restritos");
  const hoje = todayISO();
  const em7 = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const [resumoRes, exigRes, docRes, metasRes, meusAssRes, inc, meuResumoRes] = await Promise.all([
    veClientes ? supabase.rpc("cliente_casos_resumo") : Promise.resolve({ data: null }),
    veClientes && podeRestritos
      ? supabase.from("cliente_casos").select("id, cliente_id, tipo, exigencia_prazo, exigencia_prorrogada, clientes!inner(nome)").eq("status", "exigencia").order("exigencia_prazo", { ascending: true, nullsFirst: false }).limit(8)
      : Promise.resolve({ data: [] }),
    veClientes
      ? supabase.from("clientes").select("id, nome, prazo_documentacao").eq("status_cadastro", "pendente_documentacao").lte("prazo_documentacao", em7).order("prazo_documentacao").limit(6)
      : Promise.resolve({ data: [] }),
    veClientes ? supabase.rpc("metas_processos_painel", { p_ref: hoje }) : Promise.resolve({ data: [] }),
    supabase.from("assessores").select("id").eq("user_id", userId),
    veBase ? carregarInconsistencias(can(profile, "rotas.ver")) : Promise.resolve(null),
    supabase.from("resumos_diarios").select("id").eq("usuario_id", userId).eq("data", hoje).maybeSingle(),
  ]);
  // consultores e assessores com usuário fazem o resumo do dia
  const fazResumo = ["consultor", "consultor_externo"].includes(profile.role) || (meusAssRes.data ?? []).length > 0;
  const resumoPendente = fazResumo && !meuResumoRes.data;

  const porStatus = ((resumoRes.data ?? {}) as { por_status?: Record<string, number>; total?: number }).por_status ?? {};
  const totalProc = Object.values(porStatus).reduce((a, n) => a + n, 0);
  const statusVisiveis = CASO_STATUS.filter((s) => podeRestritos || !(CASO_STATUS_RESTRITOS as readonly string[]).includes(s.value));
  const exigencias = (exigRes.data ?? []) as Exigencia[];
  const vencidas = exigencias.filter((e) => e.exigencia_prazo && e.exigencia_prazo < hoje).length;
  const docs = (docRes.data ?? []) as { id: string; nome: string; prazo_documentacao: string | null }[];
  const meusAss = new Set((meusAssRes.data ?? []).map((a) => a.id as string));
  const metas = ((metasRes.data ?? []) as MetaLinha[]).filter((m) => veBase || m.alvo === "empresa" || m.usuario_id === userId || (m.assessor_id && meusAss.has(m.assessor_id)));

  return (
    <>
      {alert}
      <PageHeader
        eyebrow={todayLong()}
        title={`${greeting()}, ${firstName}`}
        description={
          vencidas
            ? `Atenção: ${vencidas} exigência(s) com prazo vencido.`
            : "Processos, prazos, metas, reuniões e tarefas do dia."
        }
        actions={
          <>
            {podeEditar && <LinkButton href="/comercial/clientes/novo" variant="secondary" size="sm"><UserPlus className="h-4 w-4" /> Cadastrar cliente</LinkButton>}
            <LinkButton href="/agenda?novo=1" variant="secondary" size="sm"><CalendarPlus className="h-4 w-4" /> Reunião</LinkButton>
            <LinkButton href="/tarefas?novo=1" variant="accent" size="sm"><ListPlus className="h-4 w-4" /> Nova tarefa</LinkButton>
          </>
        }
      />

      {resumoPendente && (
        <Link href="/comercial/meu-resumo" className="mb-6 flex items-center gap-3 rounded-2xl border-2 border-accent-300 bg-accent-50 px-5 py-3 text-sm text-accent-900 hover:bg-accent-100 dark:border-accent-800 dark:bg-accent-900/30 dark:text-accent-100">
          <ClipboardList className="h-5 w-5 shrink-0" />
          <span className="flex-1"><b>Faça o resumo do dia</b> — processos, ligações e para quem ligou. Leva menos de 2 minutos.</span>
          <span className="font-semibold">Fazer agora</span>
        </Link>
      )}

      {veClientes && (
        <Card className="mb-6">
          <CardHeader
            icon={<FolderSearch className="h-4 w-4" />}
            title={`Processos (${num(totalProc)})`}
            description={podeRestritos ? "Situação de todos os processos" : "Processos que você pode ver (análise, pendência e exigência são restritos)"}
            action={veBase ? <Link href="/administrativo/processos" className={linkCls}>Abrir lista</Link> : undefined}
          />
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
            {statusVisiveis.map((s) => {
              const n = porStatus[s.value] ?? 0;
              const corpo = (
                <>
                  <span className="flex items-center gap-2 text-[11.5px] font-medium text-muted"><span className={cn("h-2 w-2 rounded-full", TONS[s.value])} />{s.label}</span>
                  <span className="mt-1 block text-xl font-bold tabular-nums">{num(n)}</span>
                </>
              );
              return veBase ? (
                <Link key={s.value} href={`/administrativo/processos?status=${s.value}`} className="card card-interactive block p-3">{corpo}</Link>
              ) : (
                <div key={s.value} className="card p-3">{corpo}</div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        {veClientes && (
          <Card>
            <CardHeader icon={<AlarmClock className="h-4 w-4" />} title="Prazos" description="Exigências: 7 dias, prorrogáveis uma vez por mais 7. Documentação: prazo do cadastro." />
            {podeRestritos && (
              <>
                <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Exigências em aberto</p>
                {exigencias.length === 0 ? (
                  <p className="px-5 py-3 text-sm text-muted">Nenhuma exigência em aberto.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {exigencias.map((e) => {
                      const cli = Array.isArray(e.clientes) ? e.clientes[0] : e.clientes;
                      return (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                          <div className="min-w-0">
                            <Link href={`/clientes/${e.cliente_id}`} className="block truncate text-sm font-medium hover:text-brand-600">{cli?.nome ?? "Cliente"}</Link>
                            <p className="text-xs text-muted">{e.tipo}{e.exigencia_prazo ? ` · prazo ${date(e.exigencia_prazo)}` : ""}</p>
                          </div>
                          <ExigenciaPrazo casoId={e.id} prazo={e.exigencia_prazo} prorrogada={e.exigencia_prorrogada} podeProrrogar={podeEditar} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
            <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Documentação vencendo (7 dias)</p>
            {docs.length === 0 ? (
              <p className="px-5 py-3 text-sm text-muted">Nenhum prazo de documentação perto do fim.</p>
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((c) => {
                  const d = c.prazo_documentacao ? daysUntil(c.prazo_documentacao) : null;
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                      <Link href={`/clientes/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:text-brand-600">{c.nome}</Link>
                      <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold", d !== null && d <= 2 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100")}>
                        {d === null ? "—" : d < 0 ? "vencido" : d === 0 ? "hoje" : `${d} dia(s)`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="h-2" />
          </Card>
        )}

        <div className="space-y-6">
          <Card>
            <CardHeader icon={<Target className="h-4 w-4" />} title="Metas" description={veBase ? "Da empresa, dos consultores e dos corretores" : "As gerais e as suas"} action={<Link href="/metas/processos" className={linkCls}>Ver metas</Link>} />
            {metas.length === 0 ? (
              <EmptyState title="Nenhuma meta ativa" description="As metas são cadastradas em Metas." />
            ) : (
              <div className="divide-y divide-line px-5">
                {metas.slice(0, 8).map((m) => <MetaProgresso key={`${m.meta_id}-${m.assessor_id}`} m={m} hoje={hoje} compacto />)}
              </div>
            )}
          </Card>
          {inc && (
            <Card>
              <CardHeader icon={<ShieldAlert className="h-4 w-4" />} title={`Inconsistências (${num(inc.todas.length)})`} description="Dados incorretos que distorcem as métricas" action={<Link href="/administrativo/inconsistencias" className={linkCls}>Ver todas</Link>} />
              {inc.todas.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nenhuma inconsistência.</p> : (
                <ul className="divide-y divide-line">
                  {inc.resumo.filter((r) => r.total > 0).slice(0, 6).map((r) => (
                    <li key={r.value}>
                      <Link href={`/administrativo/inconsistencias?tipo=${r.value}`} className="flex items-center gap-2 px-5 py-2.5 text-sm hover:bg-surface-2">
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", r.gravidade === "alta" ? "bg-red-500" : r.gravidade === "media" ? "bg-amber-500" : "bg-slate-400")} />
                        <span className="flex-1">{r.label}</span>
                        <b className="tabular-nums">{num(r.total)}</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <AgendaCard userId={userId} />
        <MinhasTarefasCard userId={userId} />
      </div>
      {can(profile, "financeiro.view") && (
        <div className="mt-6">
          <CustasResumoCard />
        </div>
      )}
    </>
  );
}
