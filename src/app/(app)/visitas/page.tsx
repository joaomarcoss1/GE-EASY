import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CalendarClock, History, MapPin, Route } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap, pageRange } from "@/lib/data";
import { dateTime, time, todayISO } from "@/lib/format";
import type { AgendaEvento, Visita } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { FilterSelect, Pagination } from "@/components/ui/filters";
import { CheckinPanel, type OpenVisit, type TodayEvent } from "@/components/visitas/checkin-panel";
import { VISITA_RESULTADOS, duration, mapsLink } from "@/components/visitas/options";

export const metadata: Metadata = { title: "Visitas & check-in" };

const BRT = "-03:00";

export default async function VisitasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { userId, profile } = await requirePermission("visitas.checkin");
  const sp = await searchParams;
  const isManager = isManagerRole(profile.role);
  const { page, size, from, to } = pageRange(sp.page, 20);
  const supabase = await createClient();

  const today = todayISO();
  const dayStart = `${today}T00:00:00${BRT}`;
  const dayEnd = `${today}T23:59:59.999${BRT}`;
  const monthStart = `${today.slice(0, 7)}-01T00:00:00${BRT}`;

  let hist = supabase.from("visitas").select("*", { count: "exact" }).order("checkin_em", { ascending: false }).range(from, to);
  const consultorFilter = isManager && sp.consultor && /^[0-9a-f-]{36}$/i.test(sp.consultor) ? sp.consultor : null;
  if (!isManager) hist = hist.eq("consultor_id", userId);
  else if (consultorFilter) hist = hist.eq("consultor_id", consultorFilter);

  let monthQ = supabase.from("visitas").select("id", { count: "exact", head: true }).gte("checkin_em", monthStart);
  let todayQ = supabase.from("visitas").select("id", { count: "exact", head: true }).gte("checkin_em", dayStart).lte("checkin_em", dayEnd);
  if (!isManager || consultorFilter) {
    monthQ = monthQ.eq("consultor_id", consultorFilter ?? userId);
    todayQ = todayQ.eq("consultor_id", consultorFilter ?? userId);
  }

  const [{ data: openRow }, { data: evRows }, { data: histRows, count }, { count: monthCount }, { count: todayCount }, clientes, profiles, consultores] = await Promise.all([
    supabase.from("visitas").select("*").eq("consultor_id", userId).is("checkout_em", null).order("checkin_em", { ascending: false }).limit(1).maybeSingle<Visita>(),
    supabase
      .from("agenda_eventos")
      .select("*")
      .eq("tipo", "visita")
      .eq("responsavel_id", userId)
      .neq("status", "cancelado")
      .gte("inicio", dayStart)
      .lte("inicio", dayEnd)
      .order("inicio"),
    hist,
    monthQ,
    todayQ,
    clienteOptions(),
    getProfileMap(),
    isManager ? consultorOptions() : Promise.resolve([]),
  ]);

  const eventos = (evRows ?? []) as AgendaEvento[];
  const visitas = (histRows ?? []) as Visita[];

  // Nomes de clientes e compromissos referenciados
  const clienteIds = [...new Set([...visitas.map((v) => v.cliente_id), openRow?.cliente_id, ...eventos.map((e) => e.cliente_id)].filter((x): x is string => !!x))];
  const { data: cliRows } = clienteIds.length ? await supabase.from("clientes").select("id, nome").in("id", clienteIds) : { data: [] };
  const clienteNome = new Map((cliRows ?? []).map((c) => [c.id as string, c.nome as string]));
  let eventoTitulo: string | null = null;
  if (openRow?.evento_id) {
    const { data: ev } = await supabase.from("agenda_eventos").select("titulo").eq("id", openRow.evento_id).maybeSingle();
    eventoTitulo = ev?.titulo ?? null;
  }

  const openVisit: OpenVisit | null = openRow
    ? {
        id: openRow.id,
        checkin_em: openRow.checkin_em,
        cliente_nome: openRow.cliente_id ? (clienteNome.get(openRow.cliente_id) ?? null) : null,
        evento_titulo: eventoTitulo,
        lat: openRow.checkin_lat,
        lng: openRow.checkin_lng,
        precisao: openRow.checkin_precisao,
      }
    : null;
  const todayEvents: TodayEvent[] = eventos.map((e) => ({ id: e.id, titulo: e.titulo, hora: e.dia_inteiro ? "Dia todo" : time(e.inicio), cliente_id: e.cliente_id, local: e.local }));

  return (
    <>
      <PageHeader eyebrow="Campo" title="Visitas & check-in" description="Registre suas visitas com localização, resultado e histórico — direto do celular." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_1fr]">
        <div className="space-y-6">
          <CheckinPanel openVisit={openVisit} clientes={clientes} eventos={openVisit ? [] : todayEvents} />

          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="text-xs text-muted">Visitas hoje</p>
              <p className="mt-1 text-2xl font-bold">{todayCount ?? 0}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-muted">Visitas no mês</p>
              <p className="mt-1 text-2xl font-bold">{monthCount ?? 0}</p>
            </div>
          </div>

          <Card>
            <CardHeader title="Agenda de hoje" description="Visitas agendadas para você" icon={<CalendarClock className="h-4 w-4" />} />
            {eventos.length === 0 ? (
              <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Nenhuma visita agendada hoje" description="Agende visitas na Agenda para vê-las aqui." />
            ) : (
              <ul className="divide-y divide-line">
                {eventos.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-0.5 rounded-lg bg-accent-50 px-2 py-1 text-xs font-bold text-accent-700 dark:bg-accent-900/30 dark:text-accent-200">{e.dia_inteiro ? "Dia" : time(e.inicio)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{e.titulo}</p>
                      <p className="truncate text-xs text-muted">
                        {e.cliente_id ? (clienteNome.get(e.cliente_id) ?? "Cliente") : "Sem cliente"}
                        {e.local ? ` · ${e.local}` : ""}
                      </p>
                    </div>
                    {e.local && (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.local)}`} target="_blank" rel="noopener noreferrer" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-brand-600 hover:bg-surface-2" aria-label="Rota no Google Maps" title="Abrir rota">
                        <Route className="h-4 w-4" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader
            title={isManager ? "Histórico de visitas da equipe" : "Meu histórico de visitas"}
            icon={<History className="h-4 w-4" />}
            action={
              isManager ? (
                <Suspense>
                  <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" className="h-9 min-w-[180px]" />
                </Suspense>
              ) : undefined
            }
          />
          {visitas.length === 0 ? (
            <EmptyState icon={<MapPin className="h-6 w-6" />} title="Nenhuma visita registrada" description="Faça seu primeiro check-in para começar o histórico." />
          ) : (
            <ul className="divide-y divide-line">
              {visitas.map((v) => {
                const map = mapsLink(v.checkin_lat, v.checkin_lng);
                const consultor = profiles.get(v.consultor_id);
                return (
                  <li key={v.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {isManager && <Avatar name={consultor?.full_name} src={consultor?.avatar_url} size={34} />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {v.cliente_id ? (
                            <Link href={`/clientes/${v.cliente_id}`} className="hover:text-brand-600">
                              {clienteNome.get(v.cliente_id) ?? "Cliente"}
                            </Link>
                          ) : (
                            "Visita sem cliente"
                          )}
                        </p>
                        <p className="text-xs text-muted">
                          {isManager && consultor ? `${consultor.full_name} · ` : ""}
                          {dateTime(v.checkin_em)}
                          {v.checkout_em ? ` · ${duration(v.checkin_em, v.checkout_em)}` : ""}
                        </p>
                        {v.observacoes && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-fg/80">{v.observacoes}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pl-0 sm:pl-0">
                      {v.checkout_em ? (
                        <StatusBadge options={VISITA_RESULTADOS} value={v.resultado} />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> Em andamento
                        </span>
                      )}
                      {map && (
                        <a href={map} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-medium hover:bg-surface-2" title={v.checkin_precisao != null ? `Precisão ±${Math.round(v.checkin_precisao)} m` : undefined}>
                          <MapPin className="h-3.5 w-3.5 text-accent-500" /> Mapa
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <Suspense>
            <Pagination page={page} pageSize={size} total={count ?? 0} />
          </Suspense>
        </Card>
      </div>
    </>
  );
}
