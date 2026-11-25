import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { FilaSetor } from "@/components/pendencias/fila-setor";

export const metadata: Metadata = { title: "Pendências" };

/** Setor de Pendências (Vânia): processos em pendência e a ficha de acompanhamento de cada um. */
export default async function PendenciasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("fichas.pendencias");
  return <FilaSetor tipo="pendencia" sp={await searchParams} />;
}
