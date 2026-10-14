"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Filtro de período (de/até) por URL para a auditoria. */
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [de, setDe] = useState(params.get("de") ?? "");
  const [ate, setAte] = useState(params.get("ate") ?? "");
  const [pending, start] = useTransition();

  function apply(nextDe: string, nextAte: string) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of [["de", nextDe], ["ate", nextAte]] as const) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    p.delete("page");
    start(() => router.replace(`${pathname}?${p}`, { scroll: false }));
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(de, ate);
      }}
    >
      <label className="sr-only" htmlFor="audit-de">
        De
      </label>
      <input id="audit-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="input h-10 w-auto" />
      <span className="text-xs text-muted">até</span>
      <label className="sr-only" htmlFor="audit-ate">
        Até
      </label>
      <input id="audit-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="input h-10 w-auto" />
      <Button type="submit" variant="secondary" size="sm" className="h-10">
        {pending && <Loader2 className="h-4 w-4 animate-spin" />} Aplicar
      </Button>
      {(params.get("de") || params.get("ate")) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-10"
          onClick={() => {
            setDe("");
            setAte("");
            apply("", "");
          }}
        >
          Limpar
        </Button>
      )}
    </form>
  );
}
