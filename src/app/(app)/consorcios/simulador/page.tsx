import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Simulador } from "@/components/consorcios/simulador";

export const metadata: Metadata = { title: "Simulador de consórcio" };

const numParam = (v: string | undefined, min: number, max: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export default async function SimuladorPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession();
  const sp = await searchParams;
  const inicial = {
    credito: numParam(sp.credito, 1000, 100_000_000),
    prazo: numParam(sp.prazo, 1, 400),
    taxaAdm: numParam(sp.taxa, 0, 100),
    fundoReserva: numParam(sp.fundo, 0, 100),
    cliente: sp.cliente?.slice(0, 120),
  };

  return (
    <>
      <Link href="/consorcios" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Consórcios
      </Link>
      <div className="no-print">
        <PageHeader eyebrow="Consórcios" title="Simulador de consórcio" description="Monte a proposta com o cliente: parcela, custo total, estratégia de lance e comparação com financiamento." />
      </div>
      <Simulador inicial={inicial} />
    </>
  );
}
