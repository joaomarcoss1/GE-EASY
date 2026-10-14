import Link from "next/link";
import { cn } from "@/lib/cn";

/** Abas de navegação (server-friendly), ativas via `?tab=` */
export function LinkTabs({ base, tabs, active }: { base: string; tabs: { key: string; label: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t, i) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={i === 0 ? base : `${base}?tab=${t.key}`}
            scroll={false}
            className={cn(
              "relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition",
              isActive ? "border-accent-500 text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cn("rounded-full px-1.5 text-[11px]", isActive ? "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200" : "bg-surface-2 text-muted")}>{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
