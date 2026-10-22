import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { AREAS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Escolha a área de trabalho" };

/**
 * Entrada por departamento: com uma área, entra direto; com várias, o usuário escolhe (a última usada
 * fica em destaque). A área só organiza a interface — as permissões continuam as mesmas.
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { erro } = await searchParams;
  if (erro === "permissao" || erro === "area") redirect(`/dashboard?erro=permissao`);
  const disponiveis = AREAS.filter((a) => session.areas.includes(a.value));
  if (disponiveis.length === 0) redirect("/dashboard");
  if (disponiveis.length === 1) redirect(disponiveis[0].href);

  return (
    <>
      <PageHeader eyebrow={session.empresa?.nome} title="Escolha a área de trabalho" description="Você pode trocar de área a qualquer momento pelo menu lateral, sem sair do sistema." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {disponiveis.map((a) => (
          <Link
            key={a.value}
            href={a.href}
            className={cn(
              "group rounded-2xl border bg-surface p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
              session.areaAtiva === a.value ? "border-brand-400 ring-2 ring-brand-200 dark:ring-brand-800" : "border-line",
            )}
          >
            <p className="text-lg font-semibold">{a.label}</p>
            <p className="mt-1 text-sm text-muted">{a.descricao}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
              Entrar <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
