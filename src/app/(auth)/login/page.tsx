import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string; motivo?: string }> }) {
  const sp = await searchParams;
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Bem-vindo de volta</h2>
      <p className="mb-8 mt-1.5 text-sm text-muted">Acesse sua conta para continuar no GE EASY.</p>
      {sp.erro === "link" && <p className="mb-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">O link expirou ou é inválido. Solicite um novo.</p>}
      {sp.motivo === "inatividade" && <p className="mb-4 rounded-xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">Sua sessão foi encerrada por inatividade, para proteger os dados do escritório. Entre novamente.</p>}
      <LoginForm next={sp.next} />
      <p className="mt-4 text-center text-sm text-muted">Sua empresa ainda não usa o GE EASY? <Link href="/cadastro" className="font-semibold text-brand-600 hover:underline">Teste grátis por 14 dias</Link></p>
      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted">
        <ShieldCheck className="h-4 w-4 text-emerald-600" /> Conexão segura · Acesso restrito a usuários autorizados
      </div>
      <p className="mt-2 text-center text-xs text-muted">
        <Link href="/privacidade" className="hover:text-fg hover:underline">Política de privacidade e proteção de dados</Link>
      </p>
      <p className="mt-4 text-center text-sm text-muted">
        Sua empresa ainda não usa o GE EASY? <Link href="/cadastro" className="font-semibold text-brand-600 hover:underline">Teste grátis por 14 dias</Link>
      </p>
    </div>
  );
}
