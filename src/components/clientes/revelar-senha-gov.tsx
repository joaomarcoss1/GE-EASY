"use client";
import { useState, useTransition } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { verSenhaGov } from "@/lib/actions/comercial";
import { useToast } from "@/components/ui/toast";

/** Mostra a senha gov sob demanda (cada visualização fica registrada na auditoria). */
export function RevelarSenhaGov({ clienteId }: { clienteId: string }) {
  const [senha, setSenha] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  if (senha)
    return (
      <span className="inline-flex items-center gap-2">
        <code className="rounded-md bg-surface-2 px-2 py-0.5 text-sm text-fg">{senha}</code>
        <button type="button" onClick={() => setSenha(null)} className="text-muted hover:text-fg" aria-label="Ocultar senha"><EyeOff className="h-4 w-4" /></button>
      </span>
    );
  return (
    <button type="button" disabled={pending} className="inline-flex items-center gap-1 font-semibold text-brand-600 dark:text-brand-300"
      onClick={() => start(async () => {
        const r = await verSenhaGov(clienteId);
        if (r.ok && r.senha) setSenha(r.senha);
        else toast(r.error ?? "Indisponível.", "error");
      })}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Ver senha
    </button>
  );
}
