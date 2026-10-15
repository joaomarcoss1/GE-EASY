"use client";
import { useTransition } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { abrirPastaDrive } from "@/lib/actions/integracoes";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

const seguro = (u?: string) => (u && /^https:\/\/drive\.google\.com\//.test(u) ? u : null);

/** Abre a pasta do processo/cliente no Drive do escritório (cria a estrutura se ainda não existir). */
export function DrivePastaButton({ tipo, id, className, variant = "link" }: { tipo: "processo" | "cliente"; id: string; className?: string; variant?: "link" | "hero" }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          // abre a aba já no clique (evita bloqueio de pop-up) e direciona quando a URL chegar
          const win = window.open("about:blank", "_blank");
          const r = await abrirPastaDrive(tipo, id);
          const url = seguro(r.url);
          if (r.ok && url) {
            if (win) {
              win.opener = null;
              win.location.href = url;
            } else window.open(url, "_blank", "noopener,noreferrer");
          } else {
            win?.close();
            toast(r.error ?? "Não foi possível abrir a pasta.", "error");
          }
        })
      }
      className={cn(
        variant === "hero"
          ? "inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25 disabled:opacity-60"
          : "inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-60 dark:text-emerald-300",
        className,
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Pasta no Drive
    </button>
  );
}
