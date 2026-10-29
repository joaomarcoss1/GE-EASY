"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Painel lateral (slide-over) para formulários. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-brand-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("absolute inset-y-0 right-0 flex w-full animate-slide-in flex-col bg-surface shadow-pop", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Modal centralizado (confirmações, formulários curtos). */
export function Modal({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-brand-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("relative w-full max-w-md animate-pop-in rounded-2xl border border-line bg-surface p-6 shadow-pop", className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
