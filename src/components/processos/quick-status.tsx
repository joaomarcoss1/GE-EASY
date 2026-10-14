"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PROCESSO_FASES, PROCESSO_STATUS } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import { useToast } from "@/components/ui/toast";

/** Selects compactos para mudar fase e situação direto do cabeçalho do processo. */
export function QuickStatus({
  id,
  fase,
  status,
  action,
}: {
  id: string;
  fase: string;
  status: string;
  action: (id: string, campo: "fase" | "status", valor: string) => Promise<ActionState>;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const change = (campo: "fase" | "status", valor: string) =>
    start(async () => {
      const r = await action(id, campo, valor);
      if (r.ok) {
        toast(r.message ?? "Atualizado.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível atualizar.", "error");
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="qs-fase">Fase</label>
      <select id="qs-fase" defaultValue={fase} disabled={pending} onChange={(e) => change("fase", e.target.value)} className="input h-9 w-auto py-1 pr-8 text-xs font-semibold">
        {PROCESSO_FASES.map((o) => (
          <option key={o.value} value={o.value}>
            Fase: {o.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="qs-status">Situação</label>
      <select id="qs-status" defaultValue={status} disabled={pending} onChange={(e) => change("status", e.target.value)} className="input h-9 w-auto py-1 pr-8 text-xs font-semibold">
        {PROCESSO_STATUS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
    </div>
  );
}
