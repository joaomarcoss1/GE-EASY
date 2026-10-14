import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6 text-center">
      <div>
        <p className="text-gradient text-6xl font-extrabold">404</p>
        <h1 className="mt-3 text-xl font-semibold">Página não encontrada</h1>
        <p className="mt-1 text-sm text-muted">O conteúdo pode ter sido removido ou você não tem acesso a ele.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-sm font-semibold text-brand-600">Voltar ao painel →</Link>
      </div>
    </div>
  );
}
