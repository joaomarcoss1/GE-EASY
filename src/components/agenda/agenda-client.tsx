"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  UserRound,
  Users,
  Video,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { EVENTO_STATUS, EVENTO_TIPOS } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Drawer, Modal } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { ResourceForm, type FieldDef, type Values } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { addDays, dayLong, durationLabel, relativeDay, toLocal, WEEKDAYS_SHORT } from "./date-utils";
import { eventoValues, lembreteLabel, type CalEvent } from "./shared";
import { eventTone, toneOf } from "./tones";

interface AgendaActions {
  create: (state: ActionState, formData: FormData) => Promise<ActionState>;
  update: (state: ActionState, formData: FormData) => Promise<ActionState>;
  remove: (id: string) => Promise<ActionState>;
  setStatus: (id: string, status: string) => Promise<ActionState>;
}

interface Ctx {
  today: string;
  openCreate: (day?: string, time?: string) => void;
  openEvent: (e: CalEvent) => void;
  openDay: (day: string, items: CalEvent[]) => void;
}

const AgendaCtx = createContext<Ctx | null>(null);
const useAgenda = () => {
  const c = useContext(AgendaCtx);
  if (!c) throw new Error("useAgenda fora do AgendaProvider");
  return c;
};

const pad = (n: number) => String(n).padStart(2, "0");
function plusHour(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  const t = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

/** Data final efetiva: evento que termina às 00:00 do dia seguinte pertence ao dia anterior. */
function effEnd(e: CalEvent) {
  if (!e.dia_inteiro && e.endMin === 0 && e.endDate > e.startDate) return addDays(e.endDate, -1);
  return e.endDate;
}
const covers = (e: CalEvent, day: string) => e.startDate <= day && effEnd(e) >= day;
const sortEvents = (a: CalEvent, b: CalEvent) =>
  Number(b.dia_inteiro) - Number(a.dia_inteiro) || a.startDate.localeCompare(b.startDate) || a.startMin - b.startMin || a.titulo.localeCompare(b.titulo);

// ------------------------------------------------------------------ Provider

export function AgendaProvider({
  children,
  fields,
  actions,
  today,
  defaultStart,
  initialCreate,
}: {
  children: React.ReactNode;
  fields: FieldDef[];
  actions: AgendaActions;
  today: string;
  /** "YYYY-MM-DDTHH:mm" sugerido para o botão "Novo evento" */
  defaultStart: string;
  /** Valores iniciais quando a página abre com ?novo=1 */
  initialCreate?: Values | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [create, setCreate] = useState<{ key: number; values: Values } | null>(() =>
    initialCreate ? { key: 0, values: { tipo: "reuniao", lembrete_minutos: "30", inicio: defaultStart, fim: `${defaultStart.slice(0, 11)}${plusHour(defaultStart.slice(11, 16))}`, ...initialCreate } } : null,
  );
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState<{ day: string; items: CalEvent[] } | null>(null);

  const openCreate = useCallback(
    (d?: string, time?: string) => {
      const start = d ? `${d}T${time ?? "09:00"}` : defaultStart;
      const hm = start.slice(11, 16);
      setDay(null);
      setCreate((c) => ({ key: (c?.key ?? 0) + 1, values: { tipo: "reuniao", lembrete_minutos: "30", inicio: start, fim: `${start.slice(0, 11)}${plusHour(hm)}` } }));
    },
    [defaultStart],
  );
  const openEvent = useCallback((e: CalEvent) => {
    setDay(null);
    setEditing(false);
    setSelected(e);
  }, []);
  const openDay = useCallback((d: string, items: CalEvent[]) => setDay({ day: d, items }), []);

  const closeCreate = useCallback(() => setCreate(null), []);
  const closeEvent = useCallback(() => {
    setSelected(null);
    setEditing(false);
  }, []);
  const closeDay = useCallback(() => setDay(null), []);

  const afterCreate = useCallback(() => {
    setCreate(null);
    if (params.get("novo")) {
      const p = new URLSearchParams(params.toString());
      p.delete("novo");
      p.delete("cliente_id");
      router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
    } else router.refresh();
  }, [params, pathname, router]);

  const afterEdit = useCallback(() => {
    setSelected(null);
    setEditing(false);
    router.refresh();
  }, [router]);

  const ctx = useMemo(() => ({ today, openCreate, openEvent, openDay }), [today, openCreate, openEvent, openDay]);

  return (
    <AgendaCtx.Provider value={ctx}>
      {children}

      <Drawer open={!!create} onClose={closeCreate} title="Novo evento" description="Agende reuniões, visitas, ligações e assembleias." width="max-w-2xl">
        {create && <ResourceForm key={create.key} action={actions.create} fields={fields} values={create.values} submitLabel="Agendar" onSuccess={afterCreate} />}
      </Drawer>

      <Drawer
        open={!!selected}
        onClose={closeEvent}
        title={selected ? (editing ? "Editar evento" : selected.titulo) : ""}
        description={selected && !editing ? (selected.source === "google" ? "Evento do seu Google Agenda" : optionLabel(EVENTO_TIPOS, selected.tipo)) : undefined}
        width="max-w-xl"
      >
        {selected &&
          (editing ? (
            <ResourceForm
              key={selected.id}
              action={actions.update}
              fields={fields}
              values={eventoValues(selected)}
              hidden={{ id: selected.id }}
              submitLabel="Salvar alterações"
              onSuccess={afterEdit}
              footer={
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Voltar
                </Button>
              }
            />
          ) : (
            <EventDetails key={selected.id} event={selected} actions={actions} onEdit={() => setEditing(true)} onClose={closeEvent} />
          ))}
      </Drawer>

      <Modal open={!!day} onClose={closeDay} title={day ? dayLong(day.day) : ""} className="max-w-lg">
        {day && (
          <>
            {day.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Nenhum compromisso neste dia.</p>
            ) : (
              <ul className="-mx-2 max-h-[55vh] space-y-1 overflow-y-auto">
                {day.items.map((e) => (
                  <li key={e.id}>
                    <EventRow e={e} onClick={() => openEvent(e)} />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex justify-end">
              <Button variant="accent" onClick={() => openCreate(day.day)}>
                <Plus className="h-4 w-4" /> Novo evento neste dia
              </Button>
            </div>
          </>
        )}
      </Modal>
    </AgendaCtx.Provider>
  );
}

export function NewEventButton({ label = "Novo evento" }: { label?: string }) {
  const { openCreate } = useAgenda();
  return (
    <Button variant="accent" onClick={() => openCreate()}>
      <Plus className="h-4 w-4" /> {label}
    </Button>
  );
}

// ------------------------------------------------------------------ Detalhes

function InfoRow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 text-sm">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function whenLabel(e: CalEvent) {
  const end = effEnd(e);
  if (e.dia_inteiro) return end !== e.startDate ? `${dayLong(e.startDate)} até ${dayLong(end)} · dia inteiro` : `${dayLong(e.startDate)} · dia inteiro`;
  if (end !== e.startDate) return `${dayLong(e.startDate)}, ${e.startTime} até ${dayLong(e.endDate)}, ${e.endTime}`;
  return `${dayLong(e.startDate)} · ${e.startTime} – ${e.endTime}`;
}

function EventDetails({ event, actions, onEdit, onClose }: { event: CalEvent; actions: AgendaActions; onEdit: () => void; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState(event.status);
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<string | null>(null);
  const t = eventTone(event);
  const google = event.source === "google";
  const minutes = Math.max(0, Math.round((Date.parse(event.fim) - Date.parse(event.inicio)) / 60000));

  const change = (s: CalEvent["status"]) => {
    setTarget(s);
    start(async () => {
      const r = await actions.setStatus(event.id, s);
      if (r.ok) {
        setStatus(s);
        toast(r.message ?? "Status atualizado.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível atualizar.", "error");
    });
  };

  return (
    <div className="space-y-6">
      <div className={cn("w-full rounded-full", google ? "border-t-2 border-dashed border-slate-300 dark:border-white/25" : cn("h-1.5", t.bar))} />
      <div className="flex flex-wrap items-center gap-2">
        {google ? (
          <Badge tone="slate">Google Agenda</Badge>
        ) : event.source === "prazo" ? (
          <>
            <StatusBadge options={EVENTO_TIPOS} value={event.tipo} />
            {event.fatal && <Badge tone="red">Fatal</Badge>}
            <Badge tone="amber" dot>
              Pendente
            </Badge>
          </>
        ) : (
          <>
            <StatusBadge options={EVENTO_TIPOS} value={event.tipo} />
            <StatusBadge options={EVENTO_STATUS} value={status} />
          </>
        )}
        {!google && event.google_event_id && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <RefreshCw className="h-3.5 w-3.5" /> Sincronizado com o Google Agenda
          </span>
        )}
      </div>

      <div className="divide-y divide-line rounded-2xl border border-line px-4">
        <InfoRow icon={Clock}>
          <p className="font-medium">{whenLabel(event)}</p>
          {!event.dia_inteiro && <p className="text-xs text-muted">Duração: {durationLabel(minutes)}</p>}
        </InfoRow>
        {event.local && (
          <InfoRow icon={MapPin}>
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.local)}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-600 hover:underline">
              {event.local}
            </a>
          </InfoRow>
        )}
        {event.link_reuniao && /^https?:\/\//i.test(event.link_reuniao) && (
          <InfoRow icon={Video}>
            <a href={event.link_reuniao} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-300">
              Entrar na reunião <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="truncate text-xs text-muted">{event.link_reuniao}</p>
          </InfoRow>
        )}
        {event.cliente_id && (
          <InfoRow icon={Users}>
            <Link href={`/clientes/${event.cliente_id}`} className="font-medium hover:text-brand-600 hover:underline">
              {event.cliente_nome ?? "Ver cliente"}
            </Link>
          </InfoRow>
        )}
        {event.responsavel_nome && (
          <InfoRow icon={UserRound}>
            <span className="text-muted">Responsável: </span>
            <span className="font-medium">{event.responsavel_nome}</span>
          </InfoRow>
        )}
        {event.subtitle && (
          <InfoRow icon={Scale}>
            {event.href ? (
              <Link href={event.href} className="font-medium hover:text-brand-600 hover:underline">
                {event.subtitle}
              </Link>
            ) : (
              <span className="font-medium">{event.subtitle}</span>
            )}
          </InfoRow>
        )}
        {event.source === "app" && <InfoRow icon={Bell}>{lembreteLabel(event.lembrete_minutos)}</InfoRow>}
      </div>

      {event.descricao && (
        <div className="rounded-2xl bg-surface-2 p-4 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Descrição</p>
          <p className="whitespace-pre-wrap">{event.descricao}</p>
        </div>
      )}

      {google && event.htmlLink && (
        <a href={event.htmlLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
          <ExternalLink className="h-4 w-4" /> Abrir no Google Agenda
        </a>
      )}
      {google && <p className="text-xs text-muted">Eventos do Google Agenda são exibidos somente para leitura. Edite-os diretamente no Google.</p>}

      {!google && event.href && (
        <div className="space-y-2">
          <Link href={event.href} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface-2">
            <ExternalLink className="h-4 w-4" /> {event.href.startsWith("/processos/") ? "Abrir processo" : "Ver agenda de prazos"}
          </Link>
          {!event.canEdit && (event.source === "prazo" || event.tipo === "audiencia") && (
            <p className="text-xs text-muted">
              {event.source === "prazo"
                ? "Prazos são gerenciados na Agenda de prazos ou na aba Prazos do processo."
                : "Audiências são gerenciadas pela aba Audiências do processo (a agenda é atualizada automaticamente)."}
            </p>
          )}
        </div>
      )}

      {!google && event.canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
          {status === "agendado" ? (
            <>
              <Button variant="primary" loading={pending && target === "concluido"} disabled={pending} onClick={() => change("concluido")}>
                <CheckCircle2 className="h-4 w-4" /> Concluir
              </Button>
              <Button variant="secondary" loading={pending && target === "cancelado"} disabled={pending} onClick={() => change("cancelado")}>
                <XCircle className="h-4 w-4" /> Cancelar evento
              </Button>
            </>
          ) : (
            <Button variant="secondary" loading={pending} onClick={() => change("agendado")}>
              <RotateCcw className="h-4 w-4" /> Reabrir
            </Button>
          )}
          <Button variant="ghost" onClick={onEdit}>
            <Pencil className="h-4 w-4" /> Editar
          </Button>
          <div className="ml-auto">
            <ConfirmAction
              action={async (id) => {
                const r = await actions.remove(id);
                if (r.ok) onClose();
                return r;
              }}
              id={event.id}
              title="Excluir evento?"
              message={event.google_event_id ? "O evento também será removido do Google Agenda do responsável." : "Esta ação não pode ser desfeita."}
              label="Excluir"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Peças visuais

function EventChip({ e, onClick }: { e: CalEvent; onClick: () => void }) {
  const t = eventTone(e);
  const google = e.source === "google";
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onClick();
      }}
      title={`${e.dia_inteiro ? "Dia inteiro" : `${e.startTime}–${e.endTime}`} · ${e.titulo}`}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-[3px] text-left text-[11.5px] font-medium leading-4 transition",
        google
          ? "border border-dashed border-slate-300 bg-surface text-muted hover:border-brand-300 hover:text-fg dark:border-white/20"
          : e.dia_inteiro
            ? t.chip
            : "text-fg hover:bg-surface-2",
        e.status === "cancelado" && "line-through opacity-50",
        e.status === "concluido" && "opacity-60",
      )}
    >
      {google ? (
        <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] font-bold uppercase tracking-wide text-muted">Google</span>
      ) : (
        !e.dia_inteiro && <span className={cn("h-2 w-2 shrink-0 rounded-full", t.dot)} />
      )}
      {!e.dia_inteiro && <span className="shrink-0 tabular-nums text-muted">{e.startTime}</span>}
      <span className="truncate">{e.titulo}</span>
      {e.status === "concluido" && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />}
    </button>
  );
}

function EventRow({ e, onClick }: { e: CalEvent; onClick: () => void }) {
  const t = eventTone(e);
  const google = e.source === "google";
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-2 sm:gap-4">
      <div className="w-14 shrink-0 pt-0.5 text-sm tabular-nums sm:w-16">
        {e.dia_inteiro ? (
          <span className="text-xs font-medium text-muted">Dia inteiro</span>
        ) : (
          <>
            <span className="font-semibold">{e.startTime}</span>
            <span className="block text-xs text-muted">{e.endTime}</span>
          </>
        )}
      </div>
      <span className={cn("mt-0.5 w-1 shrink-0 self-stretch rounded-full", google ? "border-l-2 border-dashed border-slate-300 dark:border-white/25" : t.bar)} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-semibold", e.status === "cancelado" && "line-through opacity-60")}>{e.titulo}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span>{google ? "Google Agenda" : optionLabel(EVENTO_TIPOS, e.tipo)}{e.fatal ? " fatal" : ""}</span>
          {e.subtitle && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Scale className="h-3 w-3 shrink-0" />
              <span className="truncate">{e.subtitle}</span>
            </span>
          )}
          {e.cliente_nome && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {e.cliente_nome}
            </span>
          )}
          {e.local && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {e.local}
            </span>
          )}
          {e.link_reuniao && (
            <span className="inline-flex items-center gap-1">
              <Video className="h-3 w-3" />
              Online
            </span>
          )}
          {e.responsavel_nome && (
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" />
              {e.responsavel_nome}
            </span>
          )}
        </p>
      </div>
      {e.status !== "agendado" && (
        <span className="hidden shrink-0 sm:block">
          <StatusBadge options={EVENTO_STATUS} value={e.status} />
        </span>
      )}
    </button>
  );
}

// ------------------------------------------------------------------ Mês

export function MonthView({ days, month, events }: { days: string[]; month: string; events: CalEvent[] }) {
  const { today, openCreate, openEvent, openDay } = useAgenda();
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const d of days) m.set(d, events.filter((e) => covers(e, d)).sort(sortEvents));
    return m;
  }, [days, events]);
  const MAX = 3;

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
        {WEEKDAYS_SHORT.map((w, i) => (
          <div key={w} className={cn("px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted sm:text-left", (i === 0 || i === 6) && "text-muted/70")}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid" aria-label="Calendário mensal">
        {days.map((d, i) => {
          const items = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          const isToday = d === today;
          const weekend = i % 7 === 0 || i % 7 === 6;
          const extra = items.length - MAX;
          return (
            <div
              key={d}
              role="gridcell"
              aria-label={dayLong(d)}
              onClick={() => openCreate(d)}
              className={cn(
                "group relative min-h-[68px] cursor-pointer border-b border-r border-line p-1 transition-colors hover:bg-brand-50/50 dark:hover:bg-white/[0.03] sm:min-h-[122px] sm:p-1.5 [&:nth-child(7n)]:border-r-0",
                !inMonth && "bg-surface-2/70",
                inMonth && weekend && "bg-surface-2/30",
                isToday && "bg-accent-50/40 dark:bg-accent-900/10",
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold tabular-nums",
                    isToday ? "bg-accent-500 text-white shadow-glow" : inMonth ? "text-fg" : "text-muted/60",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openCreate(d);
                  }}
                  className="hidden h-6 w-6 place-items-center rounded-md text-muted opacity-0 transition hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100 sm:grid"
                  aria-label={`Novo evento em ${dayLong(d)}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1 hidden space-y-0.5 sm:block">
                {items.slice(0, extra > 0 ? MAX - 1 : MAX).map((e) => (
                  <EventChip key={e.id} e={e} onClick={() => openEvent(e)} />
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      openDay(d, items);
                    }}
                    className="w-full rounded-md px-1.5 py-0.5 text-left text-[11.5px] font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-white/5"
                  >
                    + {extra + 1} mais
                  </button>
                )}
              </div>
              {items.length > 0 && (
                <div className="mt-1 flex flex-wrap justify-center gap-0.5 sm:hidden">
                  {items.slice(0, 4).map((e) => (
                    <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", e.source === "google" ? "border border-slate-400 bg-transparent" : eventTone(e).dot)} />
                  ))}
                </div>
              )}
              <button
                type="button"
                className="absolute inset-0 sm:hidden"
                aria-label={`Ver compromissos de ${dayLong(d)}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  openDay(d, items);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Semana

const HOUR = 48;

interface Placed {
  e: CalEvent;
  lane: number;
  lanes: number;
  start: number;
  end: number;
}

/** Distribui eventos sobrepostos em colunas (lanes) dentro do dia. */
function layoutDay(evts: CalEvent[]): Placed[] {
  const items = evts
    .map((e) => ({ e, start: e.startMin, end: e.endMin === 0 && e.endDate > e.startDate ? 1440 : e.endMin }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = laneEnds.length;
    cluster.forEach((c) => (c.lanes = n));
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const it of items) {
    const visualEnd = Math.max(it.end, it.start + 30);
    if (cluster.length && it.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((le) => le <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(visualEnd);
    } else laneEnds[lane] = visualEnd;
    cluster.push({ ...it, lane, lanes: 0 });
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return out;
}

export function WeekView({ days, events, nowMin }: { days: string[]; events: CalEvent[]; nowMin: number }) {
  const { today, openCreate, openEvent } = useAgenda();
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowMin);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR - 8;
    const t = setInterval(() => setNow(toLocal(new Date().toISOString()).minutes), 60_000);
    return () => clearInterval(t);
  }, []);

  const cols = useMemo(
    () =>
      days.map((d) => {
        const list = events.filter((e) => covers(e, d));
        const timed = list.filter((e) => !e.dia_inteiro && e.startDate === d && effEnd(e) === d);
        const allDay = list.filter((e) => !timed.includes(e)).sort(sortEvents);
        return { d, allDay, timed: layoutDay(timed) };
      }),
    [days, events],
  );
  const hasAllDay = cols.some((c) => c.allDay.length > 0);
  const grid = "grid grid-cols-[52px_repeat(7,minmax(0,1fr))]";

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className={cn(grid, "border-b border-line")}>
          <div />
          {days.map((d, i) => (
            <button key={d} type="button" onClick={() => openCreate(d)} className="flex flex-col items-center gap-0.5 border-l border-line py-2.5 transition hover:bg-surface-2" aria-label={`Novo evento em ${dayLong(d)}`}>
              <span className={cn("text-[11px] font-semibold uppercase tracking-wider", d === today ? "text-accent-600" : "text-muted")}>{WEEKDAYS_SHORT[i]}</span>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full text-lg font-bold tabular-nums", d === today && "bg-accent-500 text-white shadow-glow")}>{Number(d.slice(8))}</span>
            </button>
          ))}
        </div>
        {hasAllDay && (
          <div className={cn(grid, "border-b border-line bg-surface-2/40")}>
            <div className="px-1 py-2 text-right text-[10px] font-medium leading-tight text-muted">Dia todo</div>
            {cols.map((c) => (
              <div key={c.d} className="min-w-0 space-y-0.5 border-l border-line p-1">
                {c.allDay.map((e) => (
                  <EventChip key={e.id} e={{ ...e, dia_inteiro: true }} onClick={() => openEvent(e)} />
                ))}
              </div>
            ))}
          </div>
        )}
        <div ref={scroller} className="relative max-h-[min(680px,70vh)] overflow-y-auto">
          <div className={grid} style={{ height: 24 * HOUR }}>
            <div className="relative">
              {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-muted" style={{ top: h * HOUR }}>
                  {pad(h)}:00
                </span>
              ))}
            </div>
            {cols.map((c) => (
              <div
                key={c.d}
                className={cn("relative cursor-pointer border-l border-line", c.d === today && "bg-accent-50/30 dark:bg-accent-900/10")}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, rgb(var(--line)) ${HOUR - 1}px, rgb(var(--line)) ${HOUR}px)` }}
                onClick={(ev) => {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  const mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((ev.clientY - rect.top) / HOUR) * 2) * 30));
                  openCreate(c.d, `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
                }}
              >
                {c.timed.map(({ e, lane, lanes, start, end }) => {
                  const google = e.source === "google";
                  const height = Math.max(22, ((end - start) / 60) * HOUR - 2);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openEvent(e);
                      }}
                      title={`${e.startTime}–${e.endTime} · ${e.titulo}`}
                      className={cn(
                        "absolute z-[2] overflow-hidden rounded-md px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition",
                        google ? "border border-dashed border-slate-300 bg-surface/95 text-muted hover:text-fg dark:border-white/25" : cn("border-l-[3px]", eventTone(e).block),
                        e.status === "cancelado" && "line-through opacity-50",
                        e.status === "concluido" && "opacity-60",
                      )}
                      style={{ top: (start / 60) * HOUR + 1, height, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                    >
                      <p className="truncate font-semibold">
                        {google && <span className="mr-1 text-[9px] font-bold uppercase">Google</span>}
                        {e.titulo}
                      </p>
                      {height > 30 && (
                        <p className="truncate opacity-80">
                          {e.startTime} – {e.endTime}
                        </p>
                      )}
                      {height > 56 && e.cliente_nome && <p className="truncate opacity-70">{e.cliente_nome}</p>}
                    </button>
                  );
                })}
                {c.d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-[3]" style={{ top: (now / 60) * HOUR }}>
                    <div className="relative h-0.5 bg-accent-500">
                      <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-accent-500" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Lista

export function ListView({ days, events, emptyHint }: { days: string[]; events: CalEvent[]; emptyHint?: string }) {
  const { today, openCreate, openEvent } = useAgenda();
  const groups = useMemo(
    () => days.map((d) => ({ d, items: events.filter((e) => covers(e, d)).sort(sortEvents) })).filter((g) => g.items.length > 0),
    [days, events],
  );
  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-6 w-6" />}
        title="Nenhum compromisso no período"
        description={emptyHint ?? "Agende reuniões, visitas e ligações com seus clientes."}
        action={
          <Button variant="accent" onClick={() => openCreate()}>
            <Plus className="h-4 w-4" /> Novo evento
          </Button>
        }
      />
    );
  }
  return (
    <div className="divide-y divide-line">
      {groups.map((g) => {
        const rel = relativeDay(g.d, today);
        const past = g.d < today;
        return (
          <section key={g.d} className={cn("flex flex-col gap-1 px-3 py-3 sm:flex-row sm:gap-4 sm:px-4", past && "opacity-75")}>
            <div className="flex items-center gap-3 px-2 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0 sm:pt-2">
              <span className={cn("text-2xl font-bold tabular-nums leading-none", g.d === today ? "text-accent-600" : "text-fg")}>{Number(g.d.slice(8))}</span>
              <span className="text-xs">
                {rel && <b className={cn("mr-1 font-semibold", g.d === today ? "text-accent-600" : "text-fg")}>{rel} ·</b>}
                <span className="text-muted">{dayLong(g.d)}</span>
              </span>
            </div>
            <ul className="min-w-0 flex-1 space-y-0.5">
              {g.items.map((e) => (
                <li key={e.id}>
                  <EventRow e={e} onClick={() => openEvent(e)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Pequena legenda de cores por tipo de evento */
export function TipoLegend({ google }: { google?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {EVENTO_TIPOS.filter((t) => t.value !== "outro").map((t) => (
        <span key={t.value} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", toneOf(t.value).dot)} />
          {t.label}
        </span>
      ))}
      {google && (
        <span className="inline-flex items-center gap-1.5">
          <CalendarCheck2 className="h-3.5 w-3.5" /> Google Agenda (tracejado)
        </span>
      )}
    </div>
  );
}
