import { cn } from "@/lib/cn";
import { date, daysUntil } from "@/lib/format";

/** Classes por urgência de um vencimento (dias até a data). */
function urgencyCls(dias: number) {
  if (dias < 0) return "bg-red-600 text-white";
  if (dias === 0) return "bg-accent-500 text-white";
  if (dias <= 3) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-surface-2 text-fg ring-1 ring-inset ring-line";
}

/** Selo de vencimento: "14/10 · hoje", "12/10 · 2d atraso"… */
export function DueChip({ data, className }: { data: string; className?: string }) {
  const d = daysUntil(data);
  return (
    <span className={cn("inline-flex min-w-[64px] shrink-0 flex-col items-center rounded-lg px-2 py-1 text-center leading-tight", urgencyCls(d), className)}>
      <span className="text-xs font-bold tabular-nums">{date(data).slice(0, 5)}</span>
      <span className="text-[10px] font-semibold">{d < 0 ? `${-d}d atraso` : d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d}d`}</span>
    </span>
  );
}
