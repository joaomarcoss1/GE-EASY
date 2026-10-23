"use client";
import { useState, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { verDadosBancarios } from "@/lib/actions/rh";
import { useToast } from "@/components/ui/toast";

/** Mostra os dados bancários sob demanda (cada visualização fica registrada na auditoria). */
export function RevelarBanco({ funcionarioId }: { funcionarioId: string }) {
  const [dados, setDados] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  if (dados) return <p className="whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 text-sm">{dados}</p>;
  return (
    <button type="button" disabled={pending} className="flex items-center gap-1 text-sm font-semibold text-brand-600"
      onClick={() => start(async () => {
        const r = await verDadosBancarios(funcionarioId);
        if (r.ok && r.dados) setDados(r.dados);
        else toast(r.error ?? "Indisponível.", "error");
      })}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Ver dados bancários
    </button>
  );
}
