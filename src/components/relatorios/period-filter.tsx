"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { todayISO } from "@/lib/format";
import { addDays, addMonths, currentMonth, firstDay, lastDay } from "@/components/dashboard/periods";

/** Filtro de período (`?de=YYYY-MM-DD&ate=YYYY-MM-DD`) com atalhos. */
export function PeriodFilter({ de, ate, extra }: { de: string; ate: string; /** parâmetros mantidos na URL (ex.: `secao`) */ extra?: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [a, setA] = useState(de);
  const [b, setB] = useState(ate);

  const go = (x: string, y: string) => {
    setA(x);
    setB(y);
    const p = new URLSearchParams(extra);
    p.set("de", x);
    p.set("ate", y);
    start(() => router.replace(`${pathname}?${p}`, { scroll: false }));
  };
  const mes = currentMonth();
  const today = todayISO();
  const presets = [
    { label: "Este mês", de: firstDay(mes), ate: lastDay(mes) },
    { label: "Mês anterior", de: firstDay(addMonths(mes, -1)), ate: lastDay(addMonths(mes, -1)) },
    { label: "Últimos 90 dias", de: addDays(today, -89), ate: today },
    { label: "Este ano", de: `${mes.slice(0, 4)}-01-01`, ate: `${mes.slice(0, 4)}-12-31` },
  ];

  return (
    <div className="no-print flex flex-col gap-3 lg:flex-row lg:items-center">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (a && b) go(a <= b ? a : b, a <= b ? b : a);
        }}
      >
        <CalendarRange className="h-4 w-4 text-muted" />
        <input type="date" value={a} onChange={(e) => setA(e.target.value)} className="input h-10 w-auto" aria-label="Data inicial" required />
        <span className="text-sm text-muted">até</span>
        <input type="date" value={b} onChange={(e) => setB(e.target.value)} className="input h-10 w-auto" aria-label="Data final" required />
        <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-600">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5 lg:ml-auto">
        {presets.map((p) => {
          const active = p.de === de && p.ate === ate;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => go(p.de, p.ate)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", active ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200" : "border-line text-muted hover:text-fg")}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
