import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { FilaSetor } from "@/components/pendencias/fila-setor";

export const metadata: Metadata = { title: "Exigências" };

/** Setor de Exigências (Vitória): processos em exigência no INSS, com prazo, e a ficha de acompanhamento de cada um. */
export default async function ExigenciasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("fichas.exigencias");
  return <FilaSetor tipo="exigencia" sp={await searchParams} />;
}
