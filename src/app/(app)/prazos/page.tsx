import type { Metadata } from "next";
import { Suspense } from "react";
import { AlarmClock, CalendarCheck2, CalendarClock, CalendarRange, CheckCircle2, Sun, TriangleAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole } from "@/lib/rbac";
import { departamentoOptions, juridicoOptions, processoOptions } from "@/lib/data";
import { PRAZO_STATUS, type Option } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { Prazo } from "@/lib/types";
import { createPrazo } from "@/lib/actions/prazos";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect } from "@/components/ui/filters";
import { prazoDefaults, prazoFields } from "@/components/prazos/fields";
import { toPrazoItems } from "@/components/prazos/load";
import { CalculadoraCard, NovoPrazoButton } from "@/components/prazos/prazo-drawer";
import { PrazoList } from "@/components/prazos/prazo-list";
import { addDaysYmd, situacaoPrazo, type PrazoItem, type PrazoSituacao } from "@/components/prazos/utils";
import { spStartOfDay } from "@/components/agenda/date-utils";

export const metadata: Metadata = { title: "Prazos" };

const UUID = /^[0-9a-f-]{36}$/i;
const STATUS_VALUES = PRAZO_STATUS.map((s) => s.value);

const GROUPS: { key: PrazoSituacao; title: string; hint: string; icon: React.ReactNode }[] = [
  { key: "vencido", title: "Vencidos", hint: "Pendentes com vencimento passado — dê baixa ou registre a perda", icon: <TriangleAlert className="h-4 w-4" /> },
  { key: "hoje", title: "Hoje", hint: "Vencem hoje", icon: <Sun className="h-4 w-4" /> },
  { key: "amanha", title: "Amanhã", hint: "Vencem amanhã", icon: <CalendarClock className="h-4 w-4" /> },
  { key: "semana", title: "Esta semana", hint: "Próximos 7 dias", icon: <CalendarRange className="h-4 w-4" /> },
  { key: "proximo", title: "Próximos", hint: "Depois de 7 dias", icon: <AlarmClock className="h-4 w-4" /> },
];

export default async function PrazosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePermission("processos.view");
  const { profile } = session;
  const sp = await searchParams;
  const manager = isManagerRole(profile.role);
  const canWrite = can(profile.role, "processos.write");
  const today = todayISO();
  const resp = manager && sp.resp && UUID.test(sp.resp) ? sp.resp : undefined;
  const dep = sp.dep && UUID.test(sp.dep) ? sp.dep : undefined;
  const status = sp.status && STATUS_VALUES.includes(sp.status) ? sp.status : "pendente";
  const monthStart = `${today.slice(0, 8)}01`;
  const thirtyAgo = addDaysYmd(today, -30);

  const supabase = await createClient();
  // Filtros comuns (responsável/departamento) aplicados a todas as consultas
  const rows = () => {
    let q = supabase.from("prazos").select("*");
    if (resp) q = q.eq("responsavel_id", resp);
    if (dep) q = q.eq("departamento_id", dep);
    return q;
  };
  const count = () => {
    let q = supabase.from("prazos").select("id", { count: "exact", head: true });
    if (resp) q = q.eq("responsavel_id", resp);
    if (dep) q = q.eq("departamento_id", dep);
    return q;
  };

  const mainQ =
    status === "pendente"
      ? rows().eq("status", "pendente").order("data_fim", { ascending: true }).limit(500)
      : rows().eq("status", status).order("data_fim", { ascending: false }).limit(200);
  const recentQ =
    status === "pendente"
      ? rows().eq("status", "cumprido").gte("cumprido_em", spStartOfDay(thirtyAgo)).order("cumprido_em", { ascending: false }).limit(15)
      : null;

  const [main, recent, vencidosC, hojeC, semanaC, cumpridosMesC, juridico, departamentos, processos] = await Promise.all([
    mainQ,
    recentQ ?? Promise.resolve({ data: [] }),
    count().eq("status", "pendente").lt("data_fim", today),
    count().eq("status", "pendente").eq("data_fim", today),
    count().eq("status", "pendente").gt("data_fim", today).lte("data_fim", addDaysYmd(today, 7)),
    count().eq("status", "cumprido").gte("cumprido_em", spStartOfDay(monthStart)),
    juridicoOptions(),
    departamentoOptions(),
    canWrite ? processoOptions() : Promise.resolve([] as Option[]),
  ]);

  const [items, recentItems] = await Promise.all([
    toPrazoItems((main.data ?? []) as Prazo[], session, canWrite),
    toPrazoItems((recent.data ?? []) as Prazo[], session, canWrite),
  ]);

  const fields = prazoFields({ processos, juridico, departamentos });
  const novoProcesso = sp.processo_id && UUID.test(sp.processo_id) ? sp.processo_id : undefined;
  const createValues = prazoDefaults(novoProcesso ? { processo_id: novoProcesso } : undefined);

  const groups =
    status === "pendente"
      ? GROUPS.map((g) => ({ ...g, items: items.filter((p) => situacaoPrazo(p.data_fim, today) === g.key) })).filter((g) => g.items.length > 0)
      : [];
  const statusLabel = PRAZO_STATUS.find((s) => s.value === status)?.label ?? status;

  return (
    <>
      <PageHeader
        eyebrow="Jurídico"
        title="Agenda de prazos"
        description="Prazos processuais e administrativos com contagem em dias úteis (CPC), recesso forense e feriados."
        actions={canWrite ? <NovoPrazoButton action={createPrazo} fields={fields} values={createValues} defaultOpen={sp.novo === "1"} /> : undefined}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Vencidos sem baixa" value={vencidosC.count ?? 0} hint="pendentes com data passada" icon={<TriangleAlert className="h-5 w-5" />} tone="accent" />
        <StatCard label="Vencem hoje" value={hojeC.count ?? 0} hint="prazos do dia" icon={<Sun className="h-5 w-5" />} tone="amber" />
        <StatCard label="Próximos 7 dias" value={semanaC.count ?? 0} hint="a partir de amanhã" icon={<CalendarRange className="h-5 w-5" />} />
        <StatCard label="Cumpridos no mês" value={cumpridosMesC.count ?? 0} hint="baixas registradas" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
              <Suspense fallback={<div className="h-10 w-full animate-pulse rounded-xl bg-surface-2 sm:w-96" />}>
                <FilterSelect param="status" options={PRAZO_STATUS} allLabel="Pendentes (padrão)" />
                {manager && <FilterSelect param="resp" options={juridico} allLabel="Todos os responsáveis" />}
                <FilterSelect param="dep" options={departamentos} allLabel="Todos os departamentos" />
              </Suspense>
              <span className="text-xs text-muted sm:ml-auto">
                {items.length} {status === "pendente" ? "pendente(s)" : statusLabel.toLowerCase()}
              </span>
            </div>
          </Card>

          {status === "pendente" ? (
            groups.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<CalendarCheck2 className="h-6 w-6" />}
                  title="Nenhum prazo pendente"
                  description={resp || dep ? "Ajuste os filtros para ver mais prazos." : "Tudo em dia! Cadastre novos prazos a partir das publicações."}
                />
              </Card>
            ) : (
              groups.map((g) => <PrazoGroup key={g.key} title={g.title} hint={g.hint} icon={g.icon} items={g.items} today={today} fields={fields} danger={g.key === "vencido"} />)
            )
          ) : items.length === 0 ? (
            <Card>
              <EmptyState icon={<AlarmClock className="h-6 w-6" />} title={`Nenhum prazo ${statusLabel.toLowerCase()}`} description="Ajuste os filtros para ver mais prazos." />
            </Card>
          ) : (
            <PrazoGroup title={statusLabel} hint="Ordenados pelo vencimento mais recente" icon={<AlarmClock className="h-4 w-4" />} items={items} today={today} fields={fields} />
          )}

          {status === "pendente" && recentItems.length > 0 && (
            <PrazoGroup title="Cumpridos recentes" hint="Baixas dos últimos 30 dias" icon={<CheckCircle2 className="h-4 w-4" />} items={recentItems} today={today} fields={fields} />
          )}
        </div>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <CalculadoraCard action={createPrazo} fields={fields} values={createValues} canCreate={canWrite} />
        </aside>
      </div>
    </>
  );
}

function PrazoGroup({
  title,
  hint,
  icon,
  items,
  today,
  fields,
  danger,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  items: PrazoItem[];
  today: string;
  fields: ReturnType<typeof prazoFields>;
  danger?: boolean;
}) {
  return (
    <Card className={danger ? "border-red-200 dark:border-red-900" : undefined}>
      <CardHeader
        title={
          <span className={danger ? "text-red-700 dark:text-red-300" : undefined}>
            {title} <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{items.length}</span>
          </span>
        }
        description={hint}
        icon={icon}
      />
      <PrazoList items={items} today={today} fields={fields} />
    </Card>
  );
}
