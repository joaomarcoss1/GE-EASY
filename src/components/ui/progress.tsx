import { cn } from "@/lib/cn";

export function Progress({ value, className, tone = "brand" }: { value: number; className?: string; tone?: "brand" | "accent" | "green" }) {
  const v = Math.max(0, Math.min(100, value));
  const bar = { brand: "from-brand-500 to-brand-700", accent: "from-accent-400 to-accent-600", green: "from-emerald-400 to-emerald-600" }[tone];
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full bg-gradient-to-r transition-all", bar)} style={{ width: `${v}%` }} />
    </div>
  );
}
