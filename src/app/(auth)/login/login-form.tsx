"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail, AlertCircle } from "lucide-react";
import { signIn } from "@/lib/actions/auth";
import { SubmitButton } from "@/components/ui/form";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      {state.error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" /> {state.error}
        </div>
      )}
      <div>
        <label htmlFor="email" className="label">E-mail</label>
        <div className="relative">
          <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="voce@easyconsorcios.com.br" className="input h-12 pl-10" />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="label">Senha</label>
          <Link href="/esqueci-senha" className="mb-1.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300">Esqueci minha senha</Link>
        </div>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input id="password" name="password" type={show ? "text" : "password"} required autoComplete="current-password" placeholder="••••••••••" className="input h-12 pl-10 pr-11" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-fg" aria-label={show ? "Ocultar senha" : "Mostrar senha"}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <SubmitButton variant="accent" className="h-12 w-full text-[15px]">Entrar no GE EASY</SubmitButton>
    </form>
  );
}
