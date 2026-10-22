import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { EscolherEmpresa } from "./escolher-empresa";

export const metadata: Metadata = { title: "Escolha a empresa" };
export const dynamic = "force-dynamic";

export default async function SelecionarEmpresaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.empresas.length) redirect(session.plataformaAdmin ? "/plataforma" : "/acesso-pendente");
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Escolha a empresa</h2>
      <p className="mt-2 text-sm text-muted">Você tem acesso a mais de uma empresa. Os dados de cada uma ficam totalmente separados.</p>
      <EscolherEmpresa empresas={session.empresas} atual={session.empresa?.id ?? null} />
      {session.plataformaAdmin && (
        <a href="/plataforma" className="mt-4 block text-center text-sm font-semibold text-brand-600 hover:underline">
          Painel da plataforma
        </a>
      )}
      <form action={signOut} className="mt-8 text-center">
        <button className="text-sm font-semibold text-muted hover:underline">Sair</button>
      </form>
    </div>
  );
}
