"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastKind = "success" | "error" | "info";
interface ToastItem { id: number; kind: ToastKind; message: string }

const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, message }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto relative flex animate-toast-in items-start gap-3 overflow-hidden rounded-xl border bg-surface/95 p-3.5 text-sm shadow-pop backdrop-blur-xl",
              t.kind === "success" && "border-emerald-200 dark:border-emerald-800",
              t.kind === "error" && "border-red-200 dark:border-red-800",
              t.kind === "info" && "border-line",
            )}
          >
            {t.kind === "success" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : t.kind === "error" ? <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" /> : <Info className="h-5 w-5 shrink-0 text-brand-600" />}
            <p className="flex-1 pt-0.5">{t.message}</p>
            <button onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))} className="text-muted transition hover:rotate-90 hover:text-fg" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
            <span
              aria-hidden
              className={cn("absolute inset-x-0 bottom-0 h-0.5 origin-left", t.kind === "success" ? "bg-emerald-500" : t.kind === "error" ? "bg-red-500" : "bg-brand-500")}
              style={{ animation: "shrink 4.5s linear forwards" }}
            />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
