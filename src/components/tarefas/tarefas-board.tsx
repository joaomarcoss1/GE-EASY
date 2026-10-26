"use client";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarRange, Check, CheckCircle2, ChevronDown, Inbox, PartyPopper, Scale, Sun, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRIORIDADES, TAREFA_STATUS } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { toneOf } from "@/components/departamentos/tone";

export interface TarefaItem {
  id: string;
  titulo: string;
  descricao: string | null;
  status: "pendente" | "em_andamento" | "concluida";
  prioridade: "baixa" | "media" | "alta" | "urgente";
  vencimento: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  concluida_em: string | null;
  canDelete: boolean;
  /** Demanda de departamento / vínculo com processo (opcionais) */
  departamento_id?: string | null;
  departamento_label?: string | null;
  departamento_cor?: string | null;
  processo_id?: string | null;
  processo_titulo?: string | null;
}

interface Actions {
  toggle: (id: string) => Promise<ActionState>;
  update: (state: ActionState, formData: FormData) => Promise<ActionState>;
  remove: (id: string) => Promise<ActionState>;
}

const PRIO_WEIGHT: Record<TarefaItem["prioridade"], number> = { urgente: 4, alta: 3, media: 2, baixa: 1 };
const PRIO_RING: Record<TarefaItem["prioridade"], string> = {
  urgente: "border-red-500 hover:bg-red-50 dark:hover:bg-red-950/40",
  alta: "border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/40",
  media: "border-sky-500 hover:bg-sky-50 dark:hover:bg-sky-950/40",
  baixa: "border-slate-300 hover:bg-slate-50 dark:border-white/25 dark:hover:bg-white/5",
};

const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const fmtShort = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" });

type SectionKey = "atrasadas" | "hoje" | "semana" | "sem_prazo" | "futuras";
const SECTIONS: { key: SectionKey; title: string; icon: React.ComponentType<{ className?: string }>; hint?: string }[] = [
  { key: "atrasadas", title: "Atrasadas", icon: AlertTriangle, hint: "Prazo vencido" },
  { key: "hoje", title: "Hoje", icon: Sun },
  { key: "semana", title: "Próximos 7 dias", icon: CalendarRange },
  { key: "sem_prazo", title: "Sem prazo", icon: Inbox },
  { key: "futuras", title: "Futuras", icon: CalendarClock },
];

function sectionOf(t: TarefaItem, today: string): SectionKey {
  if (!t.vencimento) return "sem_prazo";
  const d = diffDays(t.vencimento, today);
  if (d < 0) return "atrasadas";
  if (d === 0) return "hoje";
  if (d <= 7) return "semana";
  return "futuras";
}

const byPriority = (a: TarefaItem, b: TarefaItem) =>
  (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999") || PRIO_WEIGHT[b.prioridade] - PRIO_WEIGHT[a.prioridade] || a.titulo.localeCompare(b.titulo);

export function TarefasBoard({
  open,
  done,
  today,
  showResp,
  editFields,
  actions,
  filtered,
}: {
  open: TarefaItem[];
  done: TarefaItem[];
  today: string;
  showResp: boolean;
  editFields: FieldDef[];
  actions: Actions;
  filtered?: boolean;
}) {
  const toast = useToast();
  const [, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic<Record<string, boolean>, { id: string; done: boolean }>({}, (s, a) => ({ ...s, [a.id]: a.done }));
  const [showDone, setShowDone] = useState(false);

  const sections = useMemo(() => {
    const groups = new Map<SectionKey, TarefaItem[]>(SECTIONS.map((s) => [s.key, []]));
    for (const t of open) groups.get(sectionOf(t, today))!.push(t);
    for (const list of groups.values()) list.sort(byPriority);
    return groups;
  }, [open, today]);

  const toggle = (t: TarefaItem) => {
    const next = !(optimistic[t.id] ?? t.status === "concluida");
    start(async () => {
      setOptimistic({ id: t.id, done: next });
      const r = await actions.toggle(t.id);
      if (r.ok) toast(r.message ?? (next ? "Tarefa concluída." : "Tarefa reaberta."));
      else toast(r.error ?? "Não foi possível atualizar a tarefa.", "error");
    });
  };

  const rowProps = { today, showResp, editFields, actions, optimistic, onToggle: toggle };

  return (
    <div className="space-y-5">
      {open.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<PartyPopper className="h-6 w-6" />}
            title={filtered ? "Nenhuma tarefa aberta com esses filtros" : "Tudo em dia!"}
            description={filtered ? "Ajuste os filtros para ver outras tarefas." : "Você não tem tarefas pendentes. Que tal planejar os próximos contatos com seus clientes?"}
          />
        </div>
      )}

      {SECTIONS.map((s) => {
        const items = sections.get(s.key)!;
        if (!items.length) return null;
        const danger = s.key === "atrasadas";
        const Icon = s.icon;
        return (
          <section key={s.key} className={cn("card overflow-hidden", danger && "border-red-200 dark:border-red-900/60")}>
            <header className={cn("flex items-center gap-3 border-b px-5 py-3.5", danger ? "border-red-100 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/30" : "border-line")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-xl", danger ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-300" : s.key === "hoje" ? "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300" : "bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200")}>
                <Icon className="h-4 w-4" />
              </span>
              <h2 className={cn("text-[15px] font-semibold", danger && "text-red-700 dark:text-red-300")}>{s.title}</h2>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", danger ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200" : "bg-surface-2 text-muted")}>{items.length}</span>
              {s.key === "hoje" && <span className="ml-auto text-xs text-muted">{fmtShort(today)}</span>}
            </header>
            <ul className="divide-y divide-line">
              {items.map((t) => (
                <TarefaRow key={t.id} t={t} danger={danger} {...rowProps} />
              ))}
            </ul>
          </section>
        );
      })}

      {done.length > 0 && (
        <section className="card overflow-hidden">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-surface-2" aria-expanded={showDone}>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <h2 className="text-[15px] font-semibold">Concluídas</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">{done.length}</span>
            <span className="text-xs text-muted">últimas {done.length}</span>
            <ChevronDown className={cn("ml-auto h-4 w-4 text-muted transition", showDone && "rotate-180")} />
          </button>
          {showDone && (
            <ul className="divide-y divide-line border-t border-line">
              {done.map((t) => (
                <TarefaRow key={t.id} t={t} {...rowProps} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function DueLabel({ t, today, done }: { t: TarefaItem; today: string; done: boolean }) {
  if (done && t.concluida_em) {
    return <span className="text-xs text-muted">Concluída em {new Date(t.concluida_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" })}</span>;
  }
  if (!t.vencimento) return <span className="text-xs text-muted">Sem prazo</span>;
  const d = diffDays(t.vencimento, today);
  if (d < 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
        <CalendarClock className="h-3.5 w-3.5" /> {d === -1 ? "Venceu ontem" : `Venceu há ${-d} dias`}
      </span>
    );
  if (d === 0)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent-600">
        <CalendarClock className="h-3.5 w-3.5" /> Hoje
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <CalendarClock className="h-3.5 w-3.5" /> {d === 1 ? "Amanhã" : fmtShort(t.vencimento)}
    </span>
  );
}

function TarefaRow({
  t,
  today,
  showResp,
  editFields,
  actions,
  optimistic,
  onToggle,
  danger,
}: {
  t: TarefaItem;
  today: string;
  showResp: boolean;
  editFields: FieldDef[];
  actions: Actions;
  optimistic: Record<string, boolean>;
  onToggle: (t: TarefaItem) => void;
  danger?: boolean;
}) {
  const done = optimistic[t.id] ?? t.status === "concluida";
  const prio = PRIORIDADES.find((p) => p.value === t.prioridade);
  return (
    <li className={cn("group relative flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2/60", danger && !done && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-red-500")}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Reabrir "${t.titulo}"` : `Concluir "${t.titulo}"`}
        onClick={() => onToggle(t)}
        className={cn("relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-all after:absolute after:-inset-2.5 after:content-[''] active:scale-90", done ? "border-emerald-500 bg-emerald-500 text-white" : PRIO_RING[t.prioridade])}
      >
        {done && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-medium leading-5 transition", done && "text-muted line-through")}>{t.titulo}</p>
            {t.descricao && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{t.descricao}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <DueLabel t={t} today={today} done={done} />
              {t.cliente_id && (
                <Link href={`/clientes/${t.cliente_id}`} className="inline-flex max-w-[220px] items-center gap-1 truncate text-xs text-brand-700 hover:underline dark:text-brand-300">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.cliente_nome ?? "Cliente"}</span>
                </Link>
              )}
              {t.processo_id && (
                <Link href={`/processos/${t.processo_id}`} className="inline-flex max-w-[240px] items-center gap-1 truncate text-xs text-brand-700 hover:underline dark:text-brand-300">
                  <Scale className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.processo_titulo ?? "Processo"}</span>
                </Link>
              )}
              {t.departamento_id && (
                <Link href={`/departamentos/${t.departamento_id}?tab=demandas`} className="inline-flex" title="Demanda do departamento">
                  <Badge tone={toneOf(t.departamento_cor)} className="max-w-[200px] truncate">
                    {t.departamento_label ?? "Departamento"}
                  </Badge>
                </Link>
              )}
              {t.status === "em_andamento" && !done && <StatusBadge options={TAREFA_STATUS} value="em_andamento" />}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {prio && (
              <Badge tone={prio.tone ?? "slate"} className={cn(done && "opacity-60")}>
                {prio.label}
              </Badge>
            )}
            {showResp && (
              <span title={t.responsavel_nome ?? "Sem responsável"} className="inline-flex">
                <Avatar name={t.responsavel_nome ?? "?"} size={26} />
                <span className="sr-only">Responsável: {t.responsavel_nome ?? "—"}</span>
              </span>
            )}
            <div className="flex items-center opacity-100 transition sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
              <FormDrawerButton
                action={actions.update}
                fields={editFields}
                values={{ ...t }}
                hidden={{ id: t.id }}
                title="Editar tarefa"
                icon="edit"
                variant="ghost"
                size="icon"
                width="max-w-lg"
                submitLabel="Salvar alterações"
              />
              {t.canDelete && <ConfirmAction action={actions.remove} id={t.id} title="Excluir tarefa?" message={`"${t.titulo}" será excluída definitivamente.`} />}
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}
