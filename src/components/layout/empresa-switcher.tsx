"use client";
import { useTransition } from "react";
import { Building } from "lucide-react";
import { trocarEmpresa } from "@/lib/actions/empresa";
import { useToast } from "@/components/ui/toast";
import type { EmpresaResumo } from "@/lib/types";

const RAIZ = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

/** Troca de empresa sem novo login. Com domínio raiz configurado, cada empresa tem o próprio endereço. */
export function EmpresaSwitcher({ atual, empresas }: { atual: string; empresas: EmpresaResumo[] }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const trocar = (id: string) => {
    const alvo = empresas.find((e) => e.id === id);
    if (!alvo || id === atual) return;
    if (RAIZ) {
      window.location.href = `https://${alvo.slug}.${RAIZ}/inicio`;
      return;
    }
    start(async () => {
      const r = await trocarEmpresa(id);
      if (r.ok) window.location.href = "/inicio";
      else toast(r.error ?? "Não foi possível trocar de empresa.", "error");
    });
  };
  return (
    <label className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-sm md:flex" title="Empresa ativa">
      <Building className="h-4 w-4 text-muted" />
      <span className="sr-only">Empresa ativa</span>
      <select value={atual} onChange={(e) => trocar(e.target.value)} disabled={pending} className="max-w-[180px] truncate bg-transparent text-sm font-medium outline-none">
        {empresas.map((e) => (
          <option key={e.id} value={e.id}>
            {e.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
