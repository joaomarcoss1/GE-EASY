"use client";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { addMonths, currentMonth, isMonth } from "@/components/dashboard/periods";

/** Seletor de competência (`?mes=YYYY-MM`) com navegação mês a mês. */
export function MonthPicker({ param = "mes", value }: { param?: string; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const go = (mes: string) => {
    if (!isMonth(mes)) return;
    const p = new URLSearchParams(params.toString());
    if (mes === currentMonth()) p.delete(param);
    else p.set(param, mes);
    p.delete("page");
    start(() => router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false }));
  };
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm">
      <button type="button" onClick={() => go(addMonths(value, -1))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Mês anterior">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="relative">
        <input
          type="month"
          value={value}
          onChange={(e) => go(e.target.value)}
          className="h-8 rounded-lg bg-transparent px-2 text-sm font-semibold text-fg focus:outline-none [color-scheme:inherit]"
          aria-label="Competência"
        />
        {pending && <Loader2 className="absolute -right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      <button type="button" onClick={() => go(addMonths(value, 1))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="Próximo mês">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
