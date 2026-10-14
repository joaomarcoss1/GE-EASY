import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const sp = await searchParams;
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Bem-vindo de volta</h2>
      <p className="mb-8 mt-1.5 text-sm text-muted">Acesse sua conta para continuar no GE EASY.</p>
      {sp.erro === "link" && <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">O link expirou ou é inválido. Solicite um novo.</p>}
      <LoginForm next={sp.next} />
      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted">
        <ShieldCheck className="h-4 w-4 text-emerald-600" /> Conexão segura · Acesso restrito a usuários autorizados
      </div>
    </div>
  );
}
