"use client";
import { useActionState } from "react";
import Link from "next/link";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { updatePassword } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/form";

export default function ResetPage() {
  const [state, action] = useActionState(updatePassword, {});
  return (
    <div>
      <div className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"><KeyRound className="h-6 w-6" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Defina sua senha</h2>
      <p className="mb-8 mt-1.5 text-sm text-muted">Use ao menos 10 caracteres, com maiúsculas, minúsculas e números.</p>
      {state.ok ? (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><CheckCircle2 className="h-5 w-5" /> {state.message}</div>
          <Link href="/dashboard" className="block text-center text-sm font-semibold text-brand-600">Ir para o painel →</Link>
        </div>
      ) : (
        <form action={action} className="space-y-4">
          {state.error && <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{state.error}</p>}
          <div>
            <label htmlFor="password" className="label">Nova senha</label>
            <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="input h-12" />
          </div>
          <div>
            <label htmlFor="confirm" className="label">Confirmar senha</label>
            <input id="confirm" name="confirm" type="password" required autoComplete="new-password" className="input h-12" />
          </div>
          <SubmitButton variant="accent" className="h-12 w-full">Salvar senha</SubmitButton>
        </form>
      )}
    </div>
  );
}
