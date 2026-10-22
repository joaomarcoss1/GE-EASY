import Link from "next/link";
import { ArrowLeft, Globe } from "lucide-react";
import { requirePlataforma } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Área do dono da plataforma: separada das empresas (não exige empresa ativa). */
export default async function PlataformaLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlataforma();
  return (
    <div className="min-h-screen">
      <header className="brand-gradient flex h-16 items-center gap-3 px-4 text-white sm:px-8">
        <Globe className="h-5 w-5 text-accent-300" />
        <span className="font-semibold">GE EASY · Plataforma</span>
        <span className="ml-auto text-sm text-white/70">{session.profile.full_name}</span>
        {session.empresas.length > 0 && (
          <Link href="/inicio" className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"><ArrowLeft className="h-4 w-4" /> Voltar à empresa</Link>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-8">{children}</main>
    </div>
  );
}
