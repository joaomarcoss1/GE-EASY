import Link from "next/link";
import { AlarmClock, ArrowRight, BarChart3, Download, FileBarChart, FolderSearch, Gavel, History, ShieldAlert, Target, TrendingUp, Trophy, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import type { Session } from "@/lib/auth";
import { getProfileMap } from "@/lib/data";
import { CASO_STATUS } from "@/lib/constants";
import { date, dateTime, daysUntil, num, relative, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { optionLabel } from "@/components/ui/badge";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addMonths, currentMonth, lastMonths, monthLong, monthShort, spStartOf, firstDay } from "@/components/dashboard/periods";
import { FluxoProcessosChart, type FluxoPoint } from "@/components/juridico/charts";
import { MetaProgresso, type MetaLinha } from "@/components/metas/metas-processos";
import { ExigenciaPrazo } from "@/components/processos/exigencia-prazo";
import { carregarInconsistencias } from "@/lib/inconsistencias";
import { AgendaCard, greeting, MinhasTarefasCard, todayLong } from "@/components/juridico/dashboard-widgets";
import { carregarEquipe, INDICADOR_ROTULO, totalAcoes } from "@/lib/equipe";

const COR: Record<string, string> = {
  em_analise: "bg-sky-500", pendencia: "bg-amber-500", exigencia: "bg-red-500", habilitado: "bg-emerald-500",
  habilitacao: "bg-accent-500",
  deferido: "bg-green-700", indeferido: "bg-rose-600", aguardando_idade: "bg-brand-500", judicializado: "bg-violet-500",
  arquivo_morto: "bg-slate-400", outros: "bg-slate-300",
};
const linkCls = "text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300";
type Ref<T> = T | T[] | null;
const um = <T,>(r: Ref<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

interface CasoMin { id: string; status: string; recebido_em: string | null; habilitado_em: string | null; assessor_id: string | null }
interface Tramite { id: string; de: string | null; para: string; em: string; usuario_id: string | null; cliente_casos: Ref<{ tipo: string; cliente_id: string; clientes: Ref<{ nome: string }> }> }
interface Exig { id: string; cliente_id: string; tipo: string; exigencia_prazo: string | null; exigencia_prorrogada: boolean; clientes: Ref<{ nome: string }> }

/** Painel da diretoria (administrador master): visão completa dos processos, prazos, trâmites, metas e inconsistências. */
export async function PainelDiretoria({ session, firstName, alert }: { session: Session; firstName: string; alert: React.ReactNode }) {
  const { profile, userId } = session;
  const supabase = await createClient();
  const hoje = todayISO();
  const mes = currentMonth();
  const iniMes = firstDay(mes);
  const iniAnt = firstDay(addMonths(mes, -1));
  const meses = lastMonths(mes, 12);
  const ini12 = firstDay(meses[0]);
  const em7 = new Date(Date.now() + 7 * 86_400_000).toISOString();

  const [resumoRes, casos12, metasRes, tramitesRes, exigRes, docsRes, judRes, assessoresRes, profiles, inc, equipe] = await Promise.all([
    supabase.rpc("cliente_casos_resumo"),
    fetchAll<CasoMin>((f, t) =>
      supabase.from("cliente_casos").select("id, status, recebido_em, habilitado_em, assessor_id").or(`recebido_em.gte.${ini12},habilitado_em.gte.${ini12}`).order("id").range(f, t) as unknown as PromiseLike<{ data: CasoMin[] | null; error: { message: string } | null }>,
      30_000,
    ),
    supabase.rpc("metas_processos_painel", { p_ref: hoje }),
    supabase.from("cliente_casos_historico").select("id, de, para, em, usuario_id, cliente_casos(tipo, cliente_id, clientes(nome))").order("em", { ascending: false }).limit(14),
    supabase.from("cliente_casos").select("id, cliente_id, tipo, exigencia_prazo, exigencia_prorrogada, clientes!inner(nome)").eq("status", "exigencia").order("exigencia_prazo", { ascending: true, nullsFirst: false }).limit(10),
    supabase.from("clientes").select("id, nome, prazo_documentacao").eq("status_cadastro", "pendente_documentacao").lte("prazo_documentacao", em7).order("prazo_documentacao").limit(8),
    supabase.from("cliente_casos_historico").select("caso_id").eq("para", "judicializado").gte("em", spStartOf(iniMes)),
    supabase.from("assessores").select("id, nome"),
    getProfileMap(),
    carregarInconsistencias(can(profile, "rotas.ver")),
    can(profile, "clientes.ver_todos") ? carregarEquipe(iniMes, hoje) : Promise.resolve([]),
  ]);
  const equipeOrdem = [...equipe].sort((a, b) => totalAcoes(b) - totalAcoes(a) || a.nome.localeCompare(b.nome));

  const porStatus = ((resumoRes.data ?? {}) as { por_status?: Record<string, number> }).por_status ?? {};
  const total = Object.values(porStatus).reduce((a, n) => a + n, 0);
  const ativos = total - (porStatus.arquivo_morto ?? 0) - (porStatus.indeferido ?? 0);
  const novosMes = casos12.filter((c) => c.recebido_em && c.recebido_em >= iniMes).length;
  const novosAnt = casos12.filter((c) => c.recebido_em && c.recebido_em >= iniAnt && c.recebido_em < iniMes).length;
  const habMes = casos12.filter((c) => c.habilitado_em && c.habilitado_em >= iniMes).length;
  const judMes = new Set((judRes.data ?? []).map((r) => r.caso_id as string)).size;
  const metas = (metasRes.data ?? []) as MetaLinha[];
  const metaGeral = (ind: string) => metas.find((m) => m.alvo === "empresa" && m.indicador === ind && m.periodicidade === "mensal")?.valor ?? null;
  const exig = (exigRes.data ?? []) as Exig[];
  const exigVencidas = exig.filter((e) => e.exigencia_prazo && e.exigencia_prazo < hoje).length;
  const docs = (docsRes.data ?? []) as { id: string; nome: string; prazo_documentacao: string | null }[];
  const tramites = (tramitesRes.data ?? []) as Tramite[];
  const nomesAss = new Map((assessoresRes.data ?? []).map((a) => [a.id as string, a.nome as string]));
  const totalInc = inc.todas.length;
  const incAlta = inc.resumo.filter((r) => r.gravidade === "alta").reduce((a, r) => a + r.total, 0);

  const fluxo: FluxoPoint[] = meses.map((m) => ({
    mes: m,
    label: monthShort(m),
    novos: casos12.filter((c) => c.recebido_em?.startsWith(m)).length,
    encerrados: casos12.filter((c) => c.habilitado_em?.startsWith(m)).length,
  }));
  const rankingMap = new Map<string, { total: number; hab: number }>();
  for (const c of casos12) {
    if (!c.recebido_em || c.recebido_em < iniMes) continue;
    const k = c.assessor_id ?? "sem";
    const r = rankingMap.get(k) ?? { total: 0, hab: 0 };
    r.total++;
    if (c.status === "habilitado" || c.status === "deferido") r.hab++;
    rankingMap.set(k, r);
  }
  const ranking = [...rankingMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const pct = (n: number, meta: number | null) => (meta ? `${Math.round((n / meta) * 100)}% da meta de ${num(meta)}` : undefined);
  const trend = novosAnt ? { value: `${novosMes >= novosAnt ? "+" : ""}${Math.round(((novosMes - novosAnt) / novosAnt) * 100)}%`, positive: novosMes >= novosAnt } : undefined;

  return (
    <>
      {alert}
      <PageHeader
        eyebrow={todayLong()}
        title={`${greeting()}, ${firstName}`}
        description={`Painel da diretoria · ${monthLong(mes)}. ${exigVencidas ? `${exigVencidas} exigência(s) vencida(s). ` : ""}${incAlta ? `${num(incAlta)} inconsistência(s) graves.` : "Sem inconsistências graves."}`}
        actions={
          <>
            <LinkButton href="/api/casos/exportar" variant="secondary" size="sm" prefetch={false}><Download className="h-4 w-4" /> Exportar processos</LinkButton>
            <LinkButton href="/relatorios/assessores" variant="secondary" size="sm"><FileBarChart className="h-4 w-4" /> Relatório por assessor</LinkButton>
            <LinkButton href="/metas/processos" variant="accent" size="sm"><Target className="h-4 w-4" /> Metas</LinkButton>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Processos ativos" value={num(ativos)} icon={<FolderSearch className="h-5 w-5" />} hint={`${num(total)} no total`} />
        <StatCard label="Novos no mês" value={num(novosMes)} icon={<TrendingUp className="h-5 w-5" />} tone="accent" hint={`${num(novosAnt)} no mês anterior`} trend={trend} />
        <StatCard label="Habilitações no mês" value={num(habMes)} icon={<UserCheck className="h-5 w-5" />} tone="green" hint={pct(habMes, metaGeral("habilitados"))} />
        <StatCard label="Judicializados no mês" value={num(judMes)} icon={<Gavel className="h-5 w-5" />} hint={pct(judMes, metaGeral("judicializados"))} />
        <StatCard label="Exigências abertas" value={num(porStatus.exigencia ?? 0)} icon={<AlarmClock className="h-5 w-5" />} tone={exigVencidas ? "amber" : "brand"} hint={exigVencidas ? `${exigVencidas} vencida(s)` : "Nenhuma vencida"} />
        <StatCard label="Inconsistências" value={num(totalInc)} icon={<ShieldAlert className="h-5 w-5" />} tone={incAlta ? "amber" : "green"} hint={`${num(incAlta)} grave(s)`} />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Card>
          <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Divisão por status" description={`${num(total)} processos`} action={<Link href="/administrativo/processos" className={linkCls}>Abrir lista</Link>} />
          <div className="p-5">
            <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {CASO_STATUS.map((s) => (porStatus[s.value] ? <div key={s.value} className={COR[s.value]} style={{ width: `${(porStatus[s.value] / Math.max(1, total)) * 100}%` }} title={`${s.label}: ${porStatus[s.value]}`} /> : null))}
            </div>
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {CASO_STATUS.map((s) => {
                const n = porStatus[s.value] ?? 0;
                return (
                  <li key={s.value}>
                    <Link href={`/administrativo/processos?status=${s.value}`} className="group flex items-center gap-2 text-sm">
                      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", COR[s.value])} />
                      <span className="flex-1 group-hover:text-brand-600">{s.label}</span>
                      <b className="tabular-nums">{num(n)}</b>
                      <span className="w-10 text-right text-xs tabular-nums text-muted">{total ? `${Math.round((n / total) * 100)}%` : "—"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<TrendingUp className="h-4 w-4" />} title="Evolução em 12 meses" description="Processos recebidos × habilitações por mês" />
          <div className="p-5"><FluxoProcessosChart data={fluxo} rotulos={{ novos: "Recebidos", encerrados: "Habilitados" }} /></div>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<AlarmClock className="h-4 w-4" />} title="Prazos importantes" description="Exigências (7 dias, prorrogáveis uma vez) e documentação" />
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Exigências</p>
          {exig.length === 0 ? <p className="px-5 py-3 text-sm text-muted">Nenhuma exigência em aberto.</p> : (
            <ul className="divide-y divide-line">
              {exig.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/clientes/${e.cliente_id}`} className="block truncate text-sm font-medium hover:text-brand-600">{um(e.clientes)?.nome ?? "Cliente"}</Link>
                    <p className="text-xs text-muted">{e.tipo}{e.exigencia_prazo ? ` · prazo ${date(e.exigencia_prazo)}` : ""}</p>
                  </div>
                  <ExigenciaPrazo casoId={e.id} prazo={e.exigencia_prazo} prorrogada={e.exigencia_prorrogada} podeProrrogar={can(profile, "clientes.write")} />
                </li>
              ))}
            </ul>
          )}
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Documentação vencendo (7 dias)</p>
          {docs.length === 0 ? <p className="px-5 py-3 text-sm text-muted">Nenhum prazo de documentação perto do fim.</p> : (
            <ul className="divide-y divide-line">
              {docs.map((c) => {
                const d = c.prazo_documentacao ? daysUntil(c.prazo_documentacao) : null;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                    <Link href={`/clientes/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:text-brand-600">{c.nome}</Link>
                    <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold", d !== null && d <= 2 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100")}>{d === null ? "—" : d < 0 ? "vencido" : d === 0 ? "hoje" : `${d} dia(s)`}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="h-2" />
        </Card>
        <Card>
          <CardHeader icon={<History className="h-4 w-4" />} title="Trâmites recentes" description="Últimas mudanças de status dos processos" />
          {tramites.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Nenhuma mudança de status registrada ainda.</p> : (
            <ul className="divide-y divide-line">
              {tramites.map((t) => {
                const caso = um(t.cliente_casos);
                return (
                  <li key={t.id} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      {caso ? <Link href={`/clientes/${caso.cliente_id}`} className="min-w-0 truncate text-sm font-medium hover:text-brand-600">{um(caso.clientes)?.nome ?? "Cliente"}</Link> : <span className="text-sm">Processo</span>}
                      <span className="shrink-0 text-[11px] text-muted" title={dateTime(t.em)}>{relative(t.em)}</span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                      {caso?.tipo} · {t.de ? optionLabel(CASO_STATUS, t.de) : "novo"} <ArrowRight className="h-3 w-3" /> <b className="text-fg">{optionLabel(CASO_STATUS, t.para)}</b>
                      {t.usuario_id && <> · por {profiles.get(t.usuario_id)?.full_name ?? "usuário"}</>}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader icon={<Target className="h-4 w-4" />} title="Metas" description="Diretoria, geral, consultores e corretores" action={<Link href="/metas/processos" className={linkCls}>Editar metas</Link>} />
          <div className="divide-y divide-line px-5">
            {metas.length ? metas.slice(0, 12).map((m) => <MetaProgresso key={`${m.meta_id}-${m.assessor_id}`} m={m} hoje={hoje} compacto />) : <p className="py-6 text-sm text-muted">Nenhuma meta cadastrada.</p>}
          </div>
          {metas.length > 12 && <p className="px-5 py-3 text-xs text-muted"><Link href="/metas/processos" className={linkCls}>Ver as {metas.length} metas</Link></p>}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader icon={<Trophy className="h-4 w-4" />} title="Assessores no mês" description="Processos recebidos e já habilitados/deferidos" action={<Link href="/relatorios/assessores" className={linkCls}>Relatório</Link>} />
            {ranking.length === 0 ? <p className="px-5 py-6 text-sm text-muted">Nenhum processo recebido no mês.</p> : (
              <ul className="divide-y divide-line">
                {ranking.map(([id, r], i) => (
                  <li key={id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-5 text-center text-xs font-bold text-muted">{i + 1}</span>
                    <Link href={`/relatorios/assessores?assessor=${id}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand-600">{id === "sem" ? "Sem assessor" : (nomesAss.get(id) ?? "—")}</Link>
                    <b className="tabular-nums">{num(r.total)}</b>
                    <span className="w-16 text-right text-xs text-muted">{num(r.hab)} hab.</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader icon={<ShieldAlert className="h-4 w-4" />} title="Inconsistências" description="Dados incorretos que distorcem as métricas" action={<Link href="/administrativo/inconsistencias" className={linkCls}>Ver todas</Link>} />
            {totalInc === 0 ? <p className="px-5 py-6 text-sm text-muted">Nenhuma inconsistência.</p> : (
              <ul className="divide-y divide-line">
                {inc.resumo.filter((r) => r.total > 0).slice(0, 8).map((r) => (
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
        </div>
      </div>

      {equipeOrdem.length > 0 && (
        <Card className="mb-6">
          <CardHeader icon={<UserCheck className="h-4 w-4" />} title="Equipe no mês" description="O que cada pessoa registrou no sistema: análises, pendências, exigências, habilitações, fichas e resumos" action={<Link href="/relatorios/equipe" className={linkCls}>Relatório da equipe</Link>} />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Pessoa</th><th>Meta do mês</th><th className="text-right">Análises</th><th className="text-right">Pendências</th><th className="text-right">Exigências</th><th className="text-right">Habilitou</th><th className="text-right">Fichas</th><th className="text-right">Resumos</th></tr></thead>
              <tbody>
                {equipeOrdem.map((l) => {
                  const ind = Object.keys(l.metas).find((k) => k in INDICADOR_ROTULO);
                  const feito = ind ? Number((l as unknown as Record<string, number>)[ind] ?? 0) : 0;
                  const parado = totalAcoes(l) === 0;
                  return (
                    <tr key={l.usuario_id}>
                      <td><span className="font-medium">{l.nome}</span>{parado && <div className="text-[11px] text-amber-700 dark:text-amber-300">nada registrado no mês</div>}</td>
                      <td className="whitespace-nowrap text-sm">{ind ? <><b className="tabular-nums">{num(feito)}</b> de {num(l.metas[ind])} <span className="text-xs text-muted">{INDICADOR_ROTULO[ind]}</span></> : <span className="text-xs text-muted">—</span>}</td>
                      <td className="text-right tabular-nums">{num(l.analises)}</td>
                      <td className="text-right tabular-nums">{num(l.pendencias_resolvidas)}</td>
                      <td className="text-right tabular-nums">{num(l.exigencias_cumpridas)}</td>
                      <td className="text-right tabular-nums">{num(l.habilitados)}</td>
                      <td className="text-right tabular-nums">{num(l.fichas_abertas + l.fichas_encerradas)}</td>
                      <td className="text-right tabular-nums">{num(l.resumos)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <AgendaCard userId={userId} />
        <MinhasTarefasCard userId={userId} />
      </div>
    </>
  );
}
