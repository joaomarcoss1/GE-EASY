import { cn } from "@/lib/cn";

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
    brand: "from-brand-600 to-brand-800 shadow-brand-700/30",
    accent: "from-accent-400 to-accent-600 shadow-accent-600/30",
    green: "from-emerald-400 to-emerald-600 shadow-emerald-600/30",
    amber: "from-amber-400 to-amber-600 shadow-amber-600/30",
  }[tone];
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-bold tracking-tight">{value}</p>
        </div>
        {icon && <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg", toneCls)}>{icon}</div>}
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
