import { cn } from "@/lib/cn";
import type { Option, Tone } from "@/lib/constants";

const tones: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-900/50 dark:text-brand-200 dark:ring-brand-700",
  accent: "bg-accent-50 text-accent-700 ring-accent-200 dark:bg-accent-900/30 dark:text-accent-200 dark:ring-accent-800",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
  amber: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  slate: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10",
  sky: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-800",
};

export function Badge({ tone = "slate", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Badge a partir de uma lista de opções (status, etapa, etc.) */
export function StatusBadge({ options, value }: { options: Option[]; value: string | null | undefined }) {
  const o = options.find((x) => x.value === value);
  if (!o) return <span className="text-muted">—</span>;
  return (
    <Badge tone={o.tone ?? "slate"} dot>
      {o.label}
    </Badge>
  );
}

export const optionLabel = (options: Option[], value: string | null | undefined) => options.find((o) => o.value === value)?.label ?? value ?? "—";
