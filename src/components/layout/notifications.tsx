"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { relative } from "@/lib/format";
import type { Notificacao } from "@/lib/types";
import { cn } from "@/lib/cn";

export function Notifications({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Notificacao[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("notificacoes").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
    setItems((data as Notificacao[]) ?? []);
  }, [supabase, userId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((i) => !i.lida).length;
  const markAll = async () => {
    await supabase.from("notificacoes").update({ lida: true }).eq("user_id", userId).eq("lida", false);
    load();
  };
  const markOne = async (id: string) => {
    await supabase.from("notificacoes").update({ lida: true }).eq("id", id);
    setOpen(false);
    load();
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notificações (${unread} não lidas)`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-4 top-16 z-50 animate-pop-in sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[360px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notificações</p>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">
                <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted">Tudo em dia por aqui ✨</li>}
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-line last:border-0", !n.lida && "bg-brand-50/60 dark:bg-brand-900/20")}>
                <Link href={n.link ?? "#"} onClick={() => markOne(n.id)} className="block px-4 py-3 hover:bg-surface-2">
                  <div className="flex items-start gap-2">
                    {!n.lida && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-500" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{n.titulo}</p>
                      {n.mensagem && <p className="mt-0.5 text-xs text-muted">{n.mensagem}</p>}
                      <p className="mt-1 text-[11px] text-muted">{relative(n.created_at)}</p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
