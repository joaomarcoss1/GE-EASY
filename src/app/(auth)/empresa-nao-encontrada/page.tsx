import type { Metadata } from "next";
import { Building2 } from "lucide-react";

export const metadata: Metadata = { title: "Empresa não encontrada" };

export default function EmpresaNaoEncontradaPage() {
  return (
    <div className="text-center">
      <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-muted"><Building2 className="h-7 w-7" /></div>
      <h2 className="text-2xl font-bold tracking-tight">Endereço não encontrado</h2>
      <p className="mt-2 text-sm text-muted">Não há empresa ativa neste endereço. Confira o link recebido ou fale com o administrador da sua empresa.</p>
    </div>
  );
}
