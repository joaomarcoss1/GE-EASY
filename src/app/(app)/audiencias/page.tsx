import type { Metadata } from "next";
import { Suspense } from "react";
import { CalendarDays, CalendarRange, CheckCircle2, ChevronDown, Gavel, History, Sun } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole } from "@/lib/rbac";
import { departamentoOptions, juridicoOptions, processoOptions } from "@/lib/data";
import { AUDIENCIA_MODALIDADES, type Option } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { Audiencia } from "@/lib/types";
import { createAudiencia } from "@/lib/actions/audiencias";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { AudienciaList } from "@/components/audiencias/audiencia-list";
import { audienciaDefaults, audienciaFields, type AudienciaItem } from "@/components/audiencias/fields";
import { toAudienciaItems, type ProcessoResumo } from "@/components/audiencias/load";
import { addDays, dayLong, relativeDay, spStartOfDay } from "@/components/agenda/date-utils";

export const metadata: Metadata = { title: "Audiências" };

const UUID = /^[0-9a-f-]{36}$/i;
const MODALIDADES = AUDIENCIA_MODALIDADES.map((m) => m.value);
const ATIVAS = ["agendada", "redesignada"];
type Row = Audiencia & { processo: ProcessoResumo | null };

export default async function AudienciasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requirePermission("processos.view");
  const { profile } = session;
  const sp = await searchParams;
  const manager = isManagerRole(profile.role);
  const canWrite = can(profile.role, "processos.write");
  const today = todayISO();
  const resp = manager && sp.resp && UUID.test(sp.resp) ? sp.resp : undefined;
  const dep = sp.dep && UUID.test(sp.dep) ? sp.dep : undefined;
  const modalidade = sp.modalidade && MODALIDADES.includes(sp.modalidade) ? sp.modalidade : undefined;
  const monthStart = `${today.slice(0, 8)}01`;

  const supabase = await createClient();
  const PROC = "processo:processos!inner(id, titulo, numero_cnj, departamento_id)";
  const base = () => {
    let q = supabase.from("audiencias").select(`*, ${PROC}`);
    if (resp) q = q.eq("responsavel_id", resp);
    if (dep) q = q.eq("processo.departamento_id", dep);
    if (modalidade) q = q.eq("modalidade", modalidade);
    return q;
  };
  let realizadasQ = supabase.from("audiencias").select(`id, ${PROC}`, { count: "exact", head: true }).eq("status", "realizada").gte("data_hora", spStartOfDay(monthStart)).lt("data_hora", spStartOfDay(addDays(today, 1)));
  if (resp) realizadasQ = realizadasQ.eq("responsavel_id", resp);
  if (dep) realizadasQ = realizadasQ.eq("processo.departamento_id", dep);
  if (modalidade) realizadasQ = realizadasQ.eq("modalidade", modalidade);

  const [upcoming, past, realizadas, juridico, departamentos, processos] = await Promise.all([
    base()
      .gte("data_hora", spStartOfDay(today))
      .lt("data_hora", spStartOfDay(addDays(today, 61)))
      .neq("status", "cancelada")
      .order("data_hora", { ascending: true })
      .limit(500),
    base()
      .gte("data_hora", spStartOfDay(addDays(today, -30)))
      .lt("data_hora", spStartOfDay(today))
      .order("data_hora", { ascending: false })
      .limit(300),
    realizadasQ,
    juridicoOptions(),
    departamentoOptions(),
    canWrite ? processoOptions() : Promise.resolve([] as Option[]),
  ]);

  const upRows = (upcoming.data ?? []) as Row[];
  const pastRows = (past.data ?? []) as Row[];
  const known = new Map<string, ProcessoResumo>();
  for (const r of [...upRows, ...pastRows]) if (r.processo) known.set(r.processo.id, r.processo);
  // toAudienciaItems só lê as colunas de audiencias (o processo embutido vai em `known`)
  const [proximas, anteriores] = await Promise.all([
    toAudienciaItems(upRows, session, canWrite, known),
    toAudienciaItems(pastRows, session, canWrite, known),
  ]);

  const ativas = proximas.filter((a) => ATIVAS.includes(a.status));
  const weekEnd = addDays(today, 6);
  const monthEnd = addDays(today, 30);
  const hojeN = ativas.filter((a) => a.date === today).length;
  const semanaN = ativas.filter((a) => a.date <= weekEnd).length;
  const trintaN = ativas.filter((a) => a.date <= monthEnd).length;
  const semResultado = anteriores.filter((a) => ATIVAS.includes(a.status)).length;

  const byDay = new Map<string, AudienciaItem[]>();
  for (const a of proximas) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);

  const fields = audienciaFields({ processos, juridico });
  const novoProcesso = sp.processo_id && UUID.test(sp.processo_id) ? sp.processo_id : undefined;
  const filtered = !!(resp || dep || modalidade);

  return (
    <>
      <PageHeader
        eyebrow="Jurídico"
        title="Audiências"
        description="Pauta de audiências da equipe — cada audiência entra automaticamente na agenda (e no Google Agenda) do responsável."
        actions={
          canWrite ? (
            <FormDrawerButton
              action={createAudiencia}
              fields={fields}
              values={audienciaDefaults(novoProcesso ? { processo_id: novoProcesso } : undefined)}
              title="Nova audiência"
              label="Nova audiência"
              description="A audiência entra na agenda do responsável (e no Google Agenda, se conectado)."
              submitLabel="Agendar audiência"
              variant="accent"
              width="max-w-xl"
              defaultOpen={sp.novo === "1"}
            />
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Hoje" value={hojeN} hint="audiências do dia" icon={<Sun className="h-5 w-5" />} tone="accent" />
        <StatCard label="Esta semana" value={semanaN} hint="próximos 7 dias" icon={<CalendarDays className="h-5 w-5" />} tone="amber" />
        <StatCard label="Próximos 30 dias" value={trintaN} hint="agendadas e redesignadas" icon={<CalendarRange className="h-5 w-5" />} />
        <StatCard label="Realizadas no mês" value={realizadas.count ?? 0} hint="com resultado registrado" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>

      <Card className="mb-6">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <Suspense fallback={<div className="h-10 w-full animate-pulse rounded-xl bg-surface-2 sm:w-96" />}>
            {manager && <FilterSelect param="resp" options={juridico} allLabel="Todos os responsáveis" />}
            <FilterSelect param="dep" options={departamentos} allLabel="Todos os departamentos" />
            <FilterSelect param="modalidade" options={AUDIENCIA_MODALIDADES} allLabel="Todas as modalidades" />
          </Suspense>
          <span className="text-xs text-muted sm:ml-auto">Próximos 60 dias · horário de Brasília</span>
        </div>
      </Card>

      <div className="space-y-6">
        {byDay.size === 0 ? (
          <Card>
            <EmptyState
              icon={<Gavel className="h-6 w-6" />}
              title="Nenhuma audiência nos próximos 60 dias"
              description={filtered ? "Ajuste os filtros para ver mais audiências." : canWrite ? "Agende audiências a partir do processo ou pelo botão “Nova audiência”." : undefined}
            />
          </Card>
        ) : (
          [...byDay.entries()].map(([day, list]) => {
            const rel = relativeDay(day, today);
            return (
              <Card key={day} className={day === today ? "border-accent-200 dark:border-accent-900" : undefined}>
                <CardHeader
                  title={
                    <span>
                      {rel && <span className={day === today ? "text-accent-600" : undefined}>{rel} · </span>}
                      {dayLong(day)}
                    </span>
                  }
                  description={`${list.length} audiência(s)`}
                  icon={<Gavel className="h-4 w-4" />}
                />
                <AudienciaList items={list} fields={fields} />
              </Card>
            );
          })
        )}

        <details className="card group">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
              <History className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Últimos 30 dias ({anteriores.length})</span>
              <span className="block text-xs text-muted">
                {semResultado > 0 ? `${semResultado} sem resultado registrado — marque como realizada ou redesigne` : "Realizadas, redesignadas e canceladas"}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-line">
            {anteriores.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted">Nenhuma audiência nos últimos 30 dias.</p>
            ) : (
              <AudienciaList items={anteriores} fields={fields} showDate />
            )}
          </div>
        </details>
      </div>
    </>
  );
}
