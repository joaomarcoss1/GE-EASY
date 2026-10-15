import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  AlarmClock,
  BarChart3,
  Building2,
  CalendarPlus,
  FilePlus2,
  Gavel,
  History,
  ListPlus,
  PieChart,
  Scale,
  ShieldAlert,
  TrendingUp,
  Vault,
  CalendarClock,
  Hourglass,
} from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isJuridicoRole, isManagerRole } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { ANDAMENTO_TIPOS, AUDIENCIA_TIPOS, PROCESSO_AREAS, PROCESSO_FASES } from "@/lib/constants";
import { brl, brlShort, dateTime, num, relative, time, todayISO } from "@/lib/format";
import type { Departamento, DepartamentoMembro } from "@/lib/types";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { DonutChart, HBarChart } from "@/components/dashboard/charts";
import { PermissionAlert } from "@/components/dashboard/permission-alert";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, currentMonth, lastMonths, monthShort, spDateOf, spStartOf, sum, TZ } from "@/components/dashboard/periods";
import { FluxoProcessosChart, type FluxoPoint } from "@/components/juridico/charts";
import { DueChip } from "@/components/juridico/due-chip";
import { AgendaCard, ComercialLink, ComercialResumoCard, CustasResumoCard, greeting, MinhasTarefasCard, todayLong } from "@/components/juridico/dashboard-widgets";
import { depSigla, depTone } from "@/components/departamentos/tone";

export const metadata: Metadata = { title: "Painel" };

type Num = number | string;
type Ref<T> = T | T[] | null;
const one = <T,>(r: Ref<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

interface ProcRow {
  id: string;
  area: string;
  fase: string;
  status: string;
  risco: string | null;
  valor_provisionado: Num | null;
  departamento_id: string | null;
  data_distribuicao: string | null;
  data_encerramento: string | null;
  created_at: string;
}
interface PrazoRow {
  id: string;
  descricao: string;
  data_fim: string;
  fatal: boolean;
  processo_id: string | null;
  responsavel_id: string | null;
  departamento_id: string | null;
  processos: Ref<{ titulo: string }>;
}
interface AudRow {
  id: string;
  tipo: string;
  data_hora: string;
  modalidade: string;
  local: string | null;
  processo_id: string;
  responsavel_id: string | null;
  processos: Ref<{ titulo: string; departamento_id: string | null }>;
}
interface AndamentoRow {
  id: string;
  data: string;
  tipo: string;
  descricao: string;
  processo_id: string;
  autor_id: string | null;
  created_at: string;
  processos: Ref<{ titulo: string }>;
}

const ATIVOS = ["ativo", "suspenso"];
const linkCls = "text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const { profile } = session;
  const firstName = (profile.full_name || profile.email).split(/\s+/)[0];
  const alert =
    sp.erro === "permissao" ? (
      <Suspense fallback={null}>
        <PermissionAlert />
      </Suspense>
    ) : null;

  if (!isJuridicoRole(profile.role)) {
    return <PainelGeral alert={alert} firstName={firstName} session={session} />;
  }
  return <PainelJuridico alert={alert} firstName={firstName} session={session} />;
}

type Session = Awaited<ReturnType<typeof requireSession>>;

// =====================================================================================
// Painel jurídico (admin, gestor, advogado, assistente jurídico)
// =====================================================================================
async function PainelJuridico({ alert, firstName, session }: { alert: React.ReactNode; firstName: string; session: Session }) {
  const { profile, userId } = session;
  const manager = isManagerRole(profile.role);
  const supabase = await createClient();
  const today = todayISO();
  const in5 = addDays(today, 5);
  const nowIso = new Date().toISOString();
  const in7Iso = new Date(spStartOf(addDays(today, 8))).toISOString();
  const meses = lastMonths(currentMonth(), 12);

  const [processos, prazos, audRes, andRes, depsRes, membrosRes, profiles] = await Promise.all([
    fetchAll<ProcRow>((f, t) =>
      supabase.from("processos").select("id, area, fase, status, risco, valor_provisionado, departamento_id, data_distribuicao, data_encerramento, created_at").order("id").range(f, t),
    ),
    fetchAll<PrazoRow>((f, t) =>
      supabase.from("prazos").select("id, descricao, data_fim, fatal, processo_id, responsavel_id, departamento_id, processos(titulo)").eq("status", "pendente").order("data_fim").order("id").range(f, t),
    ),
    supabase
      .from("audiencias")
      .select("id, tipo, data_hora, modalidade, local, processo_id, responsavel_id, processos(titulo, departamento_id)")
      .in("status", ["agendada", "redesignada"])
      .gte("data_hora", nowIso)
      .lt("data_hora", in7Iso)
      .order("data_hora")
      .limit(500),
    supabase.from("processo_andamentos").select("id, data, tipo, descricao, processo_id, autor_id, created_at, processos(titulo)").order("created_at", { ascending: false }).limit(10),
    supabase.from("departamentos").select("id, nome, sigla, cor, responsavel_id, ativo").eq("ativo", true).order("nome"),
    supabase.from("departamento_membros").select("departamento_id, user_id, funcao"),
    getProfileMap(),
  ]);
  const audiencias = (audRes.data ?? []) as unknown as AudRow[];
  const andamentos = (andRes.data ?? []) as unknown as AndamentoRow[];
  const deps = (depsRes.data ?? []) as Departamento[];
  const membros = (membrosRes.data ?? []) as DepartamentoMembro[];
  const nome = (uid: string | null) => (uid ? (profiles.get(uid)?.full_name ?? "—") : "—");

  // ------------------------------------------------------------------ KPIs
  const ativos = processos.filter((p) => ATIVOS.includes(p.status));
  const vencidos = prazos.filter((p) => p.data_fim < today);
  const proximos = prazos.filter((p) => p.data_fim >= today && p.data_fim <= in5);
  const hoje = prazos.filter((p) => p.data_fim === today);
  const provisionado = sum(ativos, (p) => p.valor_provisionado);
  const provaveis = ativos.filter((p) => p.risco === "provavel");
  const provavelValor = sum(provaveis, (p) => p.valor_provisionado);

  const meusPrazos = (manager ? prazos : prazos.filter((p) => p.responsavel_id === userId)).slice(0, 10);
  const meusVencidos = prazos.filter((p) => p.responsavel_id === userId && p.data_fim < today).length;

  // ------------------------------------------------------------------ Gráficos
  const porArea = PROCESSO_AREAS.map((a) => {
    const n = ativos.filter((p) => p.area === a.value).length;
    return { label: a.label, value: n, display: num(n) };
  });
  const porFase = PROCESSO_FASES.map((f) => {
    const n = ativos.filter((p) => p.fase === f.value).length;
    return { label: f.label, value: n, display: num(n), detail: "Processos" };
  }).filter((d) => d.value > 0);
  const inicio = (p: ProcRow) => (p.data_distribuicao ?? spDateOf(p.created_at)).slice(0, 7);
  const fluxo: FluxoPoint[] = meses.map((m) => ({
    mes: m,
    label: monthShort(m),
    novos: processos.filter((p) => inicio(p) === m).length,
    encerrados: processos.filter((p) => p.data_encerramento?.slice(0, 7) === m).length,
  }));

  // ------------------------------------------------------------------ Por departamento
  const meusDeps = new Set([...membros.filter((m) => m.user_id === userId).map((m) => m.departamento_id), ...deps.filter((d) => d.responsavel_id === userId).map((d) => d.id)]);
  const depsVisiveis = manager ? deps : deps.filter((d) => meusDeps.has(d.id));
  const porDep = depsVisiveis
    .map((d) => {
      const prz = prazos.filter((p) => p.departamento_id === d.id);
      return {
        d,
        processos: ativos.filter((p) => p.departamento_id === d.id).length,
        prazos: prz.length,
        vencidos: prz.filter((p) => p.data_fim < today).length,
        audiencias: audiencias.filter((a) => one(a.processos)?.departamento_id === d.id).length,
      };
    })
    .sort((a, b) => b.vencidos - a.vencidos || b.processos - a.processos);
  const semDep = ativos.filter((p) => !p.departamento_id).length;

  const canWrite = can(profile.role, "processos.write");
  const comercial = can(profile.role, "comercial.view");

  return (
    <>
      {alert}
      <PageHeader
        eyebrow={todayLong()}
        title={`${greeting()}, ${firstName}`}
        description={
          vencidos.length
            ? `Atenção: ${num(vencidos.length)} prazo(s) vencido(s) sem baixa${hoje.length ? ` e ${num(hoje.length)} vencendo hoje` : ""}.`
            : hoje.length
              ? `${num(hoje.length)} prazo(s) vencem hoje.`
              : "Nenhum prazo vencido — carteira em dia."
        }
        actions={
          <>
            {canWrite && (
              <>
                <LinkButton href="/processos?novo=1" variant="secondary" size="sm">
                  <FilePlus2 className="h-4 w-4" /> Novo processo
                </LinkButton>
                <LinkButton href="/prazos?novo=1" variant="secondary" size="sm">
                  <AlarmClock className="h-4 w-4" /> Novo prazo
                </LinkButton>
                <LinkButton href="/audiencias?novo=1" variant="secondary" size="sm">
                  <CalendarPlus className="h-4 w-4" /> Nova audiência
                </LinkButton>
              </>
            )}
            <LinkButton href="/tarefas?novo=1" variant="accent" size="sm">
              <ListPlus className="h-4 w-4" /> Nova demanda
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard label="Processos ativos" value={num(ativos.length)} icon={<Scale className="h-5 w-5" />} hint={`${num(ativos.filter((p) => p.status === "suspenso").length)} suspenso(s) · ${num(processos.length)} na carteira`} />
        <StatCard
          label="Prazos vencidos sem baixa"
          value={<span className={vencidos.length ? "text-red-600 dark:text-red-400" : undefined}>{num(vencidos.length)}</span>}
          icon={<ShieldAlert className="h-5 w-5" />}
          tone={vencidos.length ? "accent" : "green"}
          hint={vencidos.length ? (meusVencidos ? `${num(meusVencidos)} sob sua responsabilidade` : "dar baixa ou justificar") : "nenhum vencido"}
        />
        <StatCard label="Prazos hoje + 5 dias" value={num(proximos.length)} icon={<Hourglass className="h-5 w-5" />} tone="amber" hint={`${num(hoje.length)} hoje · até ${in5.split("-").reverse().slice(0, 2).join("/")}`} />
        <StatCard label="Audiências em 7 dias" value={num(audiencias.length)} icon={<Gavel className="h-5 w-5" />} hint={audiencias[0] ? `próxima: ${dateTime(audiencias[0].data_hora)}` : "nenhuma agendada"} />
        <StatCard
          label="Valor provisionado"
          value={brlShort(provisionado)}
          icon={<Vault className="h-5 w-5" />}
          tone="green"
          hint={`risco provável: ${num(provaveis.length)} · ${brlShort(provavelValor)}`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            icon={<AlarmClock className="h-4 w-4" />}
            title={manager ? "Próximos prazos" : "Meus prazos"}
            description={manager ? "Todos os prazos pendentes, do mais urgente" : "Prazos pendentes sob sua responsabilidade"}
            action={
              <Link href="/prazos" className={linkCls}>
                Ver prazos
              </Link>
            }
          />
          {meusPrazos.length === 0 ? (
            <EmptyState icon={<AlarmClock className="h-6 w-6" />} title="Nenhum prazo pendente" description="Quando houver prazos sob sua responsabilidade, eles aparecem aqui." />
          ) : (
            <ul className="divide-y divide-line">
              {meusPrazos.map((p) => {
                const late = p.data_fim < today;
                const proc = one(p.processos);
                return (
                  <li key={p.id} className={cn("relative flex items-center gap-3 px-5 py-3", late && "bg-red-50/60 dark:bg-red-950/20")}>
                    <DueChip data={p.data_fim} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-sm font-medium", late && "text-red-700 dark:text-red-300")}>{p.descricao}</p>
                      <p className="truncate text-xs text-muted">
                        {p.processo_id ? (
                          <Link href={`/processos/${p.processo_id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                            {proc?.titulo ?? "Processo"}
                          </Link>
                        ) : (
                          "Prazo administrativo"
                        )}
                        {manager && ` · ${nome(p.responsavel_id)}`}
                      </p>
                    </div>
                    {p.fatal && <Badge tone="red">Fatal</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            icon={<Gavel className="h-4 w-4" />}
            title="Próximas audiências"
            description="Próximos 7 dias"
            action={
              <Link href="/audiencias" className={linkCls}>
                Audiências
              </Link>
            }
          />
          {audiencias.length === 0 ? (
            <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Nenhuma audiência" description="Não há audiências agendadas nos próximos 7 dias." />
          ) : (
            <ul className="divide-y divide-line">
              {audiencias.slice(0, 8).map((a) => {
                const d = spDateOf(a.data_hora);
                const isToday = d === today;
                return (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <div
                      className={cn(
                        "grid w-14 shrink-0 place-items-center rounded-xl py-1.5 text-center leading-tight",
                        isToday ? "bg-accent-500 text-white" : "bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200",
                      )}
                    >
                      <span className="text-[10px] font-semibold uppercase">
                        {isToday ? "hoje" : new Date(a.data_hora).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "")}
                      </span>
                      <span className="text-sm font-bold tabular-nums">{time(a.data_hora)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/processos/${a.processo_id}`} className="block truncate text-sm font-medium hover:text-brand-600">
                        {one(a.processos)?.titulo ?? "Processo"}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {optionLabel(AUDIENCIA_TIPOS, a.tipo)} · {d.split("-").reverse().slice(0, 2).join("/")}
                        {a.modalidade === "virtual" ? " · virtual" : a.local ? ` · ${a.local}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader icon={<PieChart className="h-4 w-4" />} title="Processos por área" description="Carteira ativa" />
          <CardBody>
            <DonutChart data={porArea} centerLabel="Ativos" centerValue={num(ativos.length)} money={false} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Processos por fase" description="Carteira ativa" />
          <CardBody>
            <HBarChart data={porFase} labelWidth={160} emptyText="Nenhum processo ativo." />
          </CardBody>
        </Card>
        <Card>
          <CardHeader icon={<TrendingUp className="h-4 w-4" />} title="Novos × encerrados" description="Últimos 12 meses · distribuição e encerramento" />
          <CardBody>
            <FluxoProcessosChart data={fluxo} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            icon={<Building2 className="h-4 w-4" />}
            title="Por departamento"
            description={manager ? "Todos os departamentos ativos" : "Seus departamentos"}
            action={
              <Link href="/departamentos" className={linkCls}>
                Departamentos
              </Link>
            }
          />
          {porDep.length === 0 ? (
            <EmptyState icon={<Building2 className="h-6 w-6" />} title="Sem departamentos" description={manager ? "Cadastre departamentos para organizar a carteira." : "Você ainda não faz parte de um departamento."} />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Departamento</th>
                    <th className="text-right">Processos ativos</th>
                    <th className="text-right">Prazos pendentes</th>
                    <th className="text-right">Vencidos</th>
                    <th className="text-right">Audiências 7d</th>
                  </tr>
                </thead>
                <tbody>
                  {porDep.map((r) => {
                    const tone = depTone(r.d.cor);
                    return (
                      <tr key={r.d.id}>
                        <td>
                          <Link href={`/departamentos/${r.d.id}`} className="group flex items-center gap-2.5">
                            <span className={cn("grid h-7 w-9 shrink-0 place-items-center rounded-lg text-[10px] font-bold", tone.chip)}>{depSigla(r.d)}</span>
                            <span className="truncate font-medium group-hover:text-brand-600">{r.d.nome}</span>
                          </Link>
                        </td>
                        <td className="text-right tabular-nums">{num(r.processos)}</td>
                        <td className="text-right tabular-nums">{num(r.prazos)}</td>
                        <td className="text-right tabular-nums">
                          {r.vencidos ? (
                            <Badge tone="red" dot>
                              {num(r.vencidos)}
                            </Badge>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{num(r.audiencias)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {manager && semDep > 0 && <p className="border-t border-line px-5 py-3 text-xs text-muted">{num(semDep)} processo(s) ativo(s) sem departamento definido.</p>}
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader icon={<History className="h-4 w-4" />} title="Movimentações recentes" description="Últimos andamentos dos seus processos" />
          {andamentos.length === 0 ? (
            <EmptyState icon={<History className="h-6 w-6" />} title="Sem movimentações" description="Publicações, decisões e petições registradas aparecem aqui." />
          ) : (
            <ul className="divide-y divide-line">
              {andamentos.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge options={ANDAMENTO_TIPOS} value={a.tipo} />
                    <Link href={`/processos/${a.processo_id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600">
                      {one(a.processos)?.titulo ?? "Processo"}
                    </Link>
                    <span className="shrink-0 text-[11px] text-muted" title={dateTime(a.created_at)}>
                      {relative(a.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{a.descricao}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className={cn("mt-6 grid gap-6", comercial ? "lg:grid-cols-2" : "lg:grid-cols-1")}>
        <MinhasTarefasCard userId={userId} />
        {comercial && (
          <div className="space-y-6">
            <ComercialResumoCard />
          </div>
        )}
      </div>
      {provisionado > 0 && (
        <p className="mt-6 text-xs text-muted">
          Valor provisionado total da carteira ativa: {brl(provisionado)}. Indicadores calculados sobre os processos que você tem permissão para acessar.
        </p>
      )}
    </>
  );
}

// =====================================================================================
// Painel geral (consultores, financeiro)
// =====================================================================================
async function PainelGeral({ alert, firstName, session }: { alert: React.ReactNode; firstName: string; session: Session }) {
  const { profile, userId } = session;
  const comercial = can(profile.role, "comercial.view");
  const financeiro = profile.role === "financeiro";
  return (
    <>
      {alert}
      <PageHeader
        eyebrow={todayLong()}
        title={`${greeting()}, ${firstName}`}
        description="Seu resumo do dia: tarefas, compromissos e indicadores."
        actions={
          <>
            <LinkButton href="/agenda?novo=1" variant="secondary" size="sm">
              <CalendarPlus className="h-4 w-4" /> Agendar
            </LinkButton>
            <LinkButton href="/tarefas?novo=1" variant="accent" size="sm">
              <ListPlus className="h-4 w-4" /> Nova tarefa
            </LinkButton>
          </>
        }
      />

      {(comercial || financeiro) && (
        <div className={cn("mb-6 grid gap-6", comercial && financeiro ? "xl:grid-cols-2" : "")}>
          {comercial && (
            <div className="space-y-4">
              <ComercialResumoCard />
              <ComercialLink />
            </div>
          )}
          {financeiro && <CustasResumoCard />}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <MinhasTarefasCard userId={userId} />
        <AgendaCard userId={userId} />
      </div>
    </>
  );
}
