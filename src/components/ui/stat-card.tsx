import { cn } from "@/lib/cn";
import { CountUp } from "./count-up";

export function StatCard({
  label,
  value,
  icon,
  hint,
  trend,
  tone = "brand",
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { value: string; positive?: boolean };
  tone?: "brand" | "accent" | "green" | "amber";
}) {
  const toneCls = {
    brand: "from-brand-500 to-brand-800 shadow-brand-700/35",
    accent: "from-accent-400 to-accent-600 shadow-accent-600/35",
    green: "from-emerald-400 to-emerald-600 shadow-emerald-600/35",
    amber: "from-amber-400 to-amber-600 shadow-amber-600/35",
  }[tone];
  const barra = { brand: "from-brand-500", accent: "from-accent-500", green: "from-emerald-500", amber: "from-amber-500" }[tone];
  return (
    <div className="card card-interactive group relative overflow-hidden p-5">
      <span className={cn("absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r to-transparent opacity-70 transition-opacity group-hover:opacity-100", barra)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-bold tracking-tight">{typeof value === "string" || typeof value === "number" ? <CountUp value={value} /> : value}</p>
        </div>
        {icon && <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg ring-1 ring-inset ring-white/15 transition-transform duration-300 ease-spring group-hover:-rotate-6 group-hover:scale-110", toneCls)}>{icon}</div>}
      </div>
      {(hint || trend) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {trend && (
            <span className={cn("rounded-full px-2 py-0.5 font-semibold", trend.positive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300")}>
              {trend.value}
            </span>
          )}
          {hint && <span className="text-muted">{hint}</span>}
        </div>
      )}
    </div>
  );
}
