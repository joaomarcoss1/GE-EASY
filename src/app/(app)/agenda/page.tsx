import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Download, Link2 } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole } from "@/lib/rbac";
import { clienteOptions, getProfileMap, userOptions } from "@/lib/data";
import { googleConfigured } from "@/lib/env";
import { listCalendarEvents } from "@/lib/google";
import { todayISO } from "@/lib/format";
import type { AgendaEvento } from "@/lib/types";
import type { Option } from "@/lib/constants";
import { createEvento, deleteEvento, setEventoStatus, updateEvento } from "@/lib/actions/agenda";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { FilterSelect, SegmentTabs } from "@/components/ui/filters";
import { StatCard } from "@/components/ui/stat-card";
import { AgendaProvider, ListView, MonthView, NewEventButton, TipoLegend, WeekView } from "@/components/agenda/agenda-client";
import { addDays, addMonths, dayRange, endOfMonth, isYmd, monthTitle, spIsoFromMs, spStartOfDay, startOfMonth, startOfWeek, toLocal, weekTitle } from "@/components/agenda/date-utils";
import { eventoFields, fromAgendaEvento, fromGoogleEvent, fromPrazo, type CalEvent } from "@/components/agenda/shared";

export const metadata: Metadata = { title: "Agenda" };

const VIEWS: Option[] = [
  { value: "mes", label: "Mês" },
  { value: "semana", label: "Semana" },
  { value: "lista", label: "Lista" },
];

const UUID = /^[0-9a-f-]{36}$/i;

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireSession();
  const sp = await searchParams;
  const view = sp.view === "semana" || sp.view === "lista" ? sp.view : "mes";
  const today = todayISO();
  const anchor = isYmd(sp.d) ? sp.d : today;
  const manager = isManagerRole(profile.role);
  const resp = manager && sp.resp && UUID.test(sp.resp) ? sp.resp : undefined;

  // Intervalo exibido
  const month = startOfMonth(anchor);
  let rangeStart: string;
  let rangeEnd: string;
  let title: string;
  let prev: string;
  let next: string;
  if (view === "semana") {
    rangeStart = startOfWeek(anchor);
    rangeEnd = addDays(rangeStart, 6);
    title = weekTitle(rangeStart);
    prev = addDays(rangeStart, -7);
    next = addDays(rangeStart, 7);
  } else {
    rangeStart = view === "mes" ? startOfWeek(month) : month;
    rangeEnd = view === "mes" ? addDays(startOfWeek(endOfMonth(month)), 6) : endOfMonth(month);
    title = monthTitle(month);
    prev = addMonths(month, -1);
    next = addMonths(month, 1);
  }
  const timeMin = spStartOfDay(rangeStart);
  const timeMax = spStartOfDay(addDays(rangeEnd, 1));

  const supabase = await createClient();
  let query = supabase.from("agenda_eventos").select("*").lt("inicio", timeMax).gte("fim", timeMin).order("inicio").limit(1000);
  if (resp) query = query.eq("responsavel_id", resp);
  // Compromissos de hoje (independente do período navegado)
  let todayQuery = supabase
    .from("agenda_eventos")
    .select("id", { count: "exact", head: true })
    .lt("inicio", spStartOfDay(addDays(today, 1)))
    .gte("fim", spStartOfDay(today))
    .neq("status", "cancelado");
  if (resp) todayQuery = todayQuery.eq("responsavel_id", resp);

  const gConfigured = googleConfigured();
  const [{ data: rows }, { count: todayCount }, profiles, clientes, users, gStatus] = await Promise.all([
    query,
    todayQuery,
    getProfileMap(),
    clienteOptions(),
    manager ? userOptions() : Promise.resolve([] as Option[]),
    gConfigured ? supabase.rpc("google_integracao_status") : Promise.resolve({ data: null }),
  ]);
  const eventos = (rows ?? []) as (AgendaEvento & { created_by: string | null })[];
  const gRows = (gStatus as { data: { conectado?: boolean; google_email?: string | null }[] | null }).data;
  const googleConnected = gConfigured && Array.isArray(gRows) && !!gRows[0]?.conectado;
  const googleEmail = googleConnected ? (gRows?.[0]?.google_email ?? null) : null;

  // Nomes dos clientes vinculados (respeitando o RLS)
  const clienteIds = [...new Set(eventos.map((e) => e.cliente_id).filter((v): v is string => !!v))];
  const clienteNomes = new Map<string, string>();
  if (clienteIds.length) {
    const { data } = await supabase.from("clientes").select("id, nome").in("id", clienteIds);
    for (const c of data ?? []) clienteNomes.set(c.id as string, c.nome as string);
  }

  const events: CalEvent[] = eventos.map((e) => {
    // Audiências/prazos vinculados a processo são geridos no módulo jurídico (somente leitura aqui).
    const processoId = (e as { processo_id?: string | null }).processo_id ?? null;
    const juridico = !!processoId && (e.tipo === "audiencia" || e.tipo === "prazo");
    return {
      ...fromAgendaEvento(e, {
        clienteNome: e.cliente_id ? (clienteNomes.get(e.cliente_id) ?? null) : null,
        responsavelNome: e.responsavel_id ? (profiles.get(e.responsavel_id)?.full_name ?? null) : null,
        canEdit: !juridico && (manager || e.responsavel_id === userId || e.created_by === userId),
      }),
      href: processoId ? `/processos/${processoId}${e.tipo === "audiencia" ? "?tab=audiencias" : ""}` : null,
    };
  });

  // Prazos processuais pendentes do período (dia inteiro, somente leitura; vermelho se fatais)
  if (can(profile.role, "processos.view")) {
    let pq = supabase
      .from("prazos")
      .select("id, descricao, data_fim, fatal, processo_id, responsavel_id")
      .eq("status", "pendente")
      .gte("data_fim", rangeStart)
      .lte("data_fim", rangeEnd)
      .order("data_fim")
      .limit(500);
    if (resp) pq = pq.eq("responsavel_id", resp);
    const { data: prazos } = await pq;
    const rows = (prazos ?? []) as { id: string; descricao: string; data_fim: string; fatal: boolean; processo_id: string | null; responsavel_id: string | null }[];
    const procIds = [...new Set(rows.map((p) => p.processo_id).filter((v): v is string => !!v))];
    const procTitulos = new Map<string, string>();
    if (procIds.length) {
      const { data } = await supabase.from("processos").select("id, titulo").in("id", procIds);
      for (const p of data ?? []) procTitulos.set(p.id as string, p.titulo as string);
    }
    for (const p of rows) {
      events.push(
        fromPrazo({
          ...p,
          processo_titulo: p.processo_id ? (procTitulos.get(p.processo_id) ?? null) : null,
          responsavel_nome: p.responsavel_id ? (profiles.get(p.responsavel_id)?.full_name ?? null) : null,
        }),
      );
    }
  }

  // Google Agenda do usuário atual (somente leitura)
  if (googleConnected && (!resp || resp === userId)) {
    try {
      const synced = new Set(eventos.map((e) => e.google_event_id).filter(Boolean));
      const items = await listCalendarEvents(userId, timeMin, timeMax);
      for (const g of items) {
        if (synced.has(g.id)) continue;
        const ev = fromGoogleEvent(g);
        if (ev) events.push(ev);
      }
    } catch (err) {
      console.error("[agenda.google.list]", err instanceof Error ? err.message : err);
    }
  }

  // KPIs rápidos (somente eventos internos do período)
  const appEvents = events.filter((e) => e.source === "app" && e.status !== "cancelado");
  const nowMs = Date.now();
  const upcoming = appEvents.filter((e) => e.status === "agendado" && Date.parse(e.inicio) >= nowMs).length;
  const visitas = appEvents.filter((e) => e.tipo === "visita").length;
  const online = appEvents.filter((e) => !!e.link_reuniao).length;

  const days = dayRange(rangeStart, rangeEnd);
  const nowLocal = toLocal(new Date(nowMs).toISOString());
  const nextHour = Math.floor(nowLocal.minutes / 60) + 1;
  const defaultStart = nextHour >= 21 ? `${addDays(today, 1)}T09:00` : `${today}T${String(Math.max(nextHour, 8)).padStart(2, "0")}:00`;

  const href = (d: string) => {
    const p = new URLSearchParams();
    if (view !== "mes") p.set("view", view);
    if (resp) p.set("resp", resp);
    if (d !== today) p.set("d", d);
    return `/agenda${p.size ? `?${p}` : ""}`;
  };

  const initialCreate =
    sp.novo === "1"
      ? {
          ...(sp.cliente_id && UUID.test(sp.cliente_id) ? { cliente_id: sp.cliente_id } : {}),
          ...(sp.oportunidade_id && UUID.test(sp.oportunidade_id) ? { oportunidade_id: sp.oportunidade_id } : {}),
        }
      : null;
  const fields = eventoFields(clientes, users, manager);
  if (initialCreate && "oportunidade_id" in initialCreate) fields.push({ name: "oportunidade_id", type: "hidden" });

  const periodLabel = view === "semana" ? "na semana" : "no mês";

  return (
    <AgendaProvider
      fields={fields}
      actions={{ create: createEvento, update: updateEvento, remove: deleteEvento, setStatus: setEventoStatus }}
      today={today}
      defaultStart={defaultStart}
      initialCreate={initialCreate}
    >
      <PageHeader
        eyebrow="Principal"
        title="Agenda"
        description={googleConnected ? `Compromissos da equipe sincronizados com o Google Agenda${googleEmail ? ` (${googleEmail})` : ""}.` : "Reuniões, visitas, ligações e assembleias da equipe."}
        actions={
          <>
            <LinkButton href={`/api/agenda/ics${resp ? `?resp=${resp}` : ""}`} variant="secondary" prefetch={false} title="Baixar arquivo .ics (próximos 180 dias)">
              <Download className="h-4 w-4" /> Exportar .ics
            </LinkButton>
            <NewEventButton />
          </>
        }
      />

      {gConfigured && !googleConnected && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 px-4 py-3.5 text-sm dark:border-brand-800 dark:bg-brand-900/30 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700 shadow-sm dark:bg-brand-900 dark:text-brand-200">
              <Link2 className="h-4 w-4" />
            </span>
            <p>
              <b className="font-semibold">Sincronize com o Google Agenda.</b>{" "}
              <span className="text-muted">Conecte sua conta Google em Configurações › Integrações para enviar seus compromissos automaticamente.</span>
            </p>
          </div>
          <LinkButton href="/configuracoes?tab=integracoes" size="sm" variant="outline" className="sm:ml-auto">
            Conectar conta Google
          </LinkButton>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Hoje" value={todayCount ?? 0} hint="compromissos não cancelados" icon={<CalendarClock className="h-5 w-5" />} tone="accent" />
        <StatCard label={`Próximos ${periodLabel}`} value={upcoming} hint="agendados a partir de agora" icon={<CalendarRange className="h-5 w-5" />} />
        <StatCard label={`Visitas ${periodLabel}`} value={visitas} hint="presenciais" icon={<CalendarDays className="h-5 w-5" />} tone="amber" />
        <StatCard label={`Reuniões online ${periodLabel}`} value={online} hint="com link de reunião" icon={<Link2 className="h-5 w-5" />} tone="green" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-2">
            <LinkButton href={href(today)} variant="secondary" size="sm">
              Hoje
            </LinkButton>
            <div className="flex items-center">
              <Link href={href(prev)} scroll={false} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label={view === "semana" ? "Semana anterior" : "Mês anterior"}>
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <Link href={href(next)} scroll={false} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label={view === "semana" ? "Próxima semana" : "Próximo mês"}>
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>
            <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {manager && <FilterSelect param="resp" options={users} allLabel="Todos os responsáveis" />}
            <SegmentTabs param="view" options={VIEWS} />
          </div>
        </div>

        {view === "mes" && (
          <>
            <MonthView days={days} month={month} events={events} />
            <div className="border-t border-line md:hidden">
              <ListView days={dayRange(month, endOfMonth(month))} events={events} emptyHint="Nenhum compromisso neste mês." />
            </div>
          </>
        )}
        {view === "semana" && <WeekView days={days} events={events} nowMin={nowLocal.minutes} />}
        {view === "lista" && <ListView days={days} events={events} emptyHint="Nenhum compromisso neste mês." />}

        <div className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <TipoLegend google={googleConnected} />
          <span className="text-xs text-muted">Horário de Brasília (UTC−03:00) · atualizado {spIsoFromMs(nowMs).slice(11, 16)}</span>
        </div>
      </Card>
    </AgendaProvider>
  );
}
