"use client";
import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, CircleDashed, Loader2, PlayCircle, RotateCcw, Scale, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRIORIDADES } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

type Status = "pendente" | "em_andamento" | "concluida";

export interface DemandaItem {
  id: string;
  titulo: string;
  descricao: string | null;
  status: Status;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  vencimento: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  responsavel_avatar: string | null;
  processo_id: string | null;
  processo_titulo: string | null;
  cliente_id: string | null;
  departamento_id: string | null;
  canEdit: boolean;
}

const COLUMNS: { key: Status; title: string; icon: React.ComponentType<{ className?: string }>; head: string; dot: string }[] = [
  { key: "pendente", title: "Pendentes", icon: CircleDashed, head: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  { key: "em_andamento", title: "Em andamento", icon: PlayCircle, head: "text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
  { key: "concluida", title: "Concluídas", icon: CheckCircle2, head: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
];

const PRIO_W: Record<DemandaItem["prioridade"], number> = { urgente: 4, alta: 3, media: 2, baixa: 1 };
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const fmtShort = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "2-digit", month: "short" });

export function DemandasBoard({
  items,
  today,
  editFields,
  actions,
}: {
  items: DemandaItem[];
  today: string;
  editFields: FieldDef[];
  actions: {
    setStatus: (id: string, status: string) => Promise<ActionState>;
    update: (state: ActionState, formData: FormData) => Promise<ActionState>;
  };
}) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [optimistic, setOptimistic] = useOptimistic<Record<string, Status>, { id: string; status: Status }>({}, (s, a) => ({ ...s, [a.id]: a.status }));

  const statusOf = (d: DemandaItem) => optimistic[d.id] ?? d.status;

  const move = (d: DemandaItem, status: Status) => {
    if (statusOf(d) === status) return;
    if (!d.canEdit) {
      toast("Você não tem permissão para alterar esta demanda.", "error");
      return;
    }
    setBusy(d.id);
    start(async () => {
      setOptimistic({ id: d.id, status });
      const r = await actions.setStatus(d.id, status);
      if (r.ok) {
        toast(r.message ?? "Demanda atualizada.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível atualizar a demanda.", "error");
      setBusy(null);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {COLUMNS.map((col) => {
        const list = items
          .filter((d) => statusOf(d) === col.key)
          .sort((a, b) =>
            col.key === "concluida" ? 0 : (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999") || PRIO_W[b.prioridade] - PRIO_W[a.prioridade],
          );
        const Icon = col.icon;
        return (
          <section
            key={col.key}
            aria-label={col.title}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.key);
            }}
            onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              const d = items.find((x) => x.id === id);
              if (d) move(d, col.key);
            }}
            className={cn("flex min-h-[220px] flex-col rounded-2xl border border-line bg-surface-2/60 p-3 transition", over === col.key && "border-brand-400 bg-brand-50/60 dark:bg-brand-900/20")}
          >
            <header className="mb-3 flex items-center gap-2 px-1">
              <Icon className={cn("h-4 w-4", col.head)} />
              <h3 className="text-sm font-semibold">{col.title}</h3>
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-muted ring-1 ring-inset ring-line">{list.length}</span>
            </header>
            <ul className="flex flex-1 flex-col gap-2.5">
              {list.length === 0 && <li className="grid flex-1 place-items-center rounded-xl border border-dashed border-line px-3 py-8 text-center text-xs text-muted">Nenhuma demanda</li>}
              {list.map((d) => {
                const st = statusOf(d);
                const prio = PRIORIDADES.find((p) => p.value === d.prioridade);
                const dd = d.vencimento ? diffDays(d.vencimento, today) : null;
                const late = st !== "concluida" && dd !== null && dd < 0;
                return (
                  <li
                    key={d.id}
                    draggable={d.canEdit}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", d.id)}
                    className={cn(
                      "group relative rounded-xl border border-line bg-surface p-3.5 shadow-sm transition hover:shadow-card",
                      d.canEdit && "cursor-grab active:cursor-grabbing",
                      late && "border-red-200 dark:border-red-900/60",
                    )}
                  >
                    {late && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-red-500" aria-hidden />}
                    <div className="flex items-start gap-2">
                      <p className={cn("min-w-0 flex-1 text-sm font-medium leading-5", st === "concluida" && "text-muted line-through")}>{d.titulo}</p>
                      {prio && st !== "concluida" && <Badge tone={prio.tone ?? "slate"}>{prio.label}</Badge>}
                    </div>
                    {d.descricao && <p className="mt-1 line-clamp-2 text-xs text-muted">{d.descricao}</p>}
                    {d.processo_id && (
                      <Link href={`/processos/${d.processo_id}`} className="mt-2 flex items-center gap-1 truncate text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                        <Scale className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{d.processo_titulo ?? "Processo"}</span>
                      </Link>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      {d.vencimento ? (
                        <span className={cn("inline-flex items-center gap-1 text-xs", late ? "font-semibold text-red-600 dark:text-red-400" : dd === 0 ? "font-semibold text-accent-600" : "text-muted")}>
                          <CalendarClock className="h-3.5 w-3.5" />
                          {late ? `Venceu ${fmtShort(d.vencimento)}` : dd === 0 ? "Hoje" : dd === 1 ? "Amanhã" : fmtShort(d.vencimento)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Sem prazo</span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1.5" title={d.responsavel_nome ?? "Sem responsável"}>
                        <Avatar name={d.responsavel_nome ?? "?"} src={d.responsavel_avatar} size={22} />
                        <span className="sr-only">Responsável: {d.responsavel_nome ?? "—"}</span>
                      </span>
                    </div>
                    {d.canEdit && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
                        {busy === d.id && pending ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted" />
                        ) : (
                          <>
                            {st === "pendente" && <MoveBtn onClick={() => move(d, "em_andamento")} icon={<PlayCircle className="h-3.5 w-3.5" />} label="Iniciar" />}
                            {st === "em_andamento" && <MoveBtn onClick={() => move(d, "pendente")} icon={<Undo2 className="h-3.5 w-3.5" />} label="Voltar" />}
                            {st !== "concluida" && <MoveBtn onClick={() => move(d, "concluida")} icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Concluir" primary />}
                            {st === "concluida" && <MoveBtn onClick={() => move(d, "pendente")} icon={<RotateCcw className="h-3.5 w-3.5" />} label="Reabrir" />}
                          </>
                        )}
                        <span className="ml-auto">
                          <FormDrawerButton
                            action={actions.update}
                            fields={editFields}
                            values={{ ...d }}
                            hidden={{ id: d.id }}
                            title="Editar demanda"
                            icon="edit"
                            variant="ghost"
                            size="icon"
                            width="max-w-lg"
                            submitLabel="Salvar alterações"
                          />
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MoveBtn({ onClick, icon, label, primary }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition",
        primary ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50" : "text-muted hover:bg-surface-2 hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
