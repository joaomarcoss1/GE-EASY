"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Option } from "@/lib/constants";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (key: string, value: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("page");
    start(() => router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false }));
  };
  return { set, params, pending };
}

export function SearchInput({ placeholder = "Buscar…", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const { set, params, pending } = useParamSetter();
  const [value, setValue] = useState(params.get(param) ?? "");
  useEffect(() => {
    const current = params.get(param) ?? "";
    if (value === current) return;
    const t = setTimeout(() => set(param, value.trim() || null), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      {pending ? <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" /> : <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />}
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="input h-10 pl-9 pr-8" aria-label={placeholder} />
      {value && (
        <button onClick={() => setValue("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg" aria-label="Limpar busca">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({ param, options, allLabel = "Todos", className }: { param: string; options: Option[]; allLabel?: string; className?: string }) {
  const { set, params } = useParamSetter();
  return (
    <select value={params.get(param) ?? ""} onChange={(e) => set(param, e.target.value || null)} className={cn("input h-10 w-auto min-w-[150px] pr-8", className)} aria-label={allLabel}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Abas (segmented control) baseadas em parâmetro de URL */
export function SegmentTabs({ param, options, className }: { param: string; options: Option[]; className?: string }) {
  const { set, params } = useParamSetter();
  const current = params.get(param) ?? options[0]?.value ?? "";
  return (
    <div className={cn("inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface-2 p-1", className)} role="tablist">
      {options.map((o, i) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => set(param, i === 0 ? null : o.value)}
            className={cn("shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition", active ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="px-5 py-3 text-xs text-muted">{total} registro(s)</div>;
  const go = (p: number) => {
    const sp = new URLSearchParams(params.toString());
    if (p > 1) sp.set("page", String(p));
    else sp.delete("page");
    router.push(`${pathname}?${sp}`, { scroll: false });
  };
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
      <span className="text-xs text-muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <div className="flex gap-1.5">
        <button disabled={page <= 1} onClick={() => go(page - 1)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-surface-2">
          Anterior
        </button>
        <span className="px-2 py-1.5 text-xs text-muted">
          {page} / {pages}
        </span>
        <button disabled={page >= pages} onClick={() => go(page + 1)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium disabled:opacity-40 hover:bg-surface-2">
          Próxima
        </button>
      </div>
    </div>
  );
}
