"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, User, Landmark, ShieldCheck, CornerDownLeft, Loader2, ArrowRight, Scale } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { NAV } from "@/lib/nav";
import { can } from "@/lib/rbac";
import type { AppRole } from "@/lib/types";
import { cn } from "@/lib/cn";

interface Result { tipo: string; id: string; titulo: string; subtitulo: string; link: string }

export function CommandPalette({ role, open, setOpen }: { role: AppRole; open: boolean; setOpen: (v: boolean) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
    else {
      setQ("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("busca_global", { termo: term.slice(0, 80) });
      setResults((data as Result[]) ?? []);
      setIdx(0);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, supabase]);

  const pages = NAV.flatMap((g) => g.items)
    .filter((i) => !i.permission || can(role, i.permission))
    .filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))
    .slice(0, q ? 4 : 6)
    .map((i) => ({ tipo: "pagina", id: i.href, titulo: i.label, subtitulo: "Ir para página", link: i.href }));

  const all = [...results, ...pages];

  const go = (r: Result) => {
    setOpen(false);
    router.push(r.link);
  };

  if (!open) return null;
  const iconFor = (t: string) => (t === "processo" ? Scale : t === "cliente" ? User : t === "consorcio" ? Landmark : t === "seguro" ? ShieldCheck : ArrowRight);
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Busca global">
      <div className="absolute inset-0 animate-fade-in bg-brand-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted" /> : <Search className="h-5 w-5 text-muted" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, all.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && all[idx]) go(all[idx]);
            }}
            placeholder="Buscar processos (nº CNJ, parte), clientes, CPF/CNPJ…"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted">ESC</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {all.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">{q.length < 2 ? "Digite ao menos 2 caracteres" : "Nada encontrado"}</li>}
          {all.map((r, i) => {
            const Icon = iconFor(r.tipo);
            return (
              <li key={r.tipo + r.id}>
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(r)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left", i === idx ? "bg-brand-50 dark:bg-brand-900/40" : "")}
                >
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-brand-600 dark:text-brand-200">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.titulo}</span>
                    <span className="block truncate text-xs text-muted">{r.subtitulo}</span>
                  </span>
                  {i === idx && <CornerDownLeft className="h-4 w-4 text-muted" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
