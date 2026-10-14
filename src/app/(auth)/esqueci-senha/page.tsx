"use client";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, MailCheck } from "lucide-react";
import { requestPasswordReset } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/form";

export default function ForgotPage() {
  const [state, action] = useActionState(requestPasswordReset, {});
  return (
    <div>
      <Link href="/login" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Voltar</Link>
      <h2 className="text-2xl font-bold tracking-tight">Recuperar acesso</h2>
      <p className="mb-8 mt-1.5 text-sm text-muted">Enviaremos um link seguro para você criar uma nova senha.</p>
      {state.ok ? (
        <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <MailCheck className="h-5 w-5 shrink-0" /> {state.message}
        </div>
      ) : (
        <form action={action} className="space-y-4">
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div>
            <label htmlFor="email" className="label">E-mail cadastrado</label>
            <input id="email" name="email" type="email" required className="input h-12" autoComplete="email" />
          </div>
          <SubmitButton variant="accent" className="h-12 w-full">Enviar link</SubmitButton>
        </form>
      )}
    </div>
  );
}
