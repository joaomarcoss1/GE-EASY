"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ShieldAlert, X } from "lucide-react";

/** Aviso dispensável exibido quando o usuário foi redirecionado por falta de permissão. */
export function PermissionAlert() {
  const [open, setOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (!open) return null;
  const dismiss = () => {
    setOpen(false);
    const p = new URLSearchParams(params.toString());
    p.delete("erro");
    router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <p className="flex-1 pt-0.5 font-medium">Você não tem permissão para acessar aquela página.</p>
      <button onClick={dismiss} className="rounded-lg p-2 hover:bg-amber-100 dark:hover:bg-amber-900/40" aria-label="Fechar aviso">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
