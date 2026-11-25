"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reclassificarDocumento } from "@/lib/actions/documentos";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { Badge, optionLabel } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

/** Categoria do documento; quem confere documentos pode trocar (o checklist e o dossiê usam a categoria). */
export function CategoriaDocumento({ id, categoria, editavel }: { id: string; categoria: string; editavel: boolean }) {
  const [valor, setValor] = useState(categoria);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (!editavel) return <Badge tone="brand">{optionLabel(DOC_CATEGORIAS, categoria)}</Badge>;
  return (
    <select
      aria-label="Categoria do documento"
      className="input h-8 w-auto max-w-[220px] py-0 text-xs"
      value={valor}
      disabled={pending}
      onChange={(e) => {
        const novo = e.target.value;
        const antes = valor;
        setValor(novo);
        start(async () => {
          const r = await reclassificarDocumento(id, novo);
          if (r.ok) { toast(r.message ?? "Categoria atualizada."); router.refresh(); } else { setValor(antes); toast(r.error ?? "Não foi possível reclassificar.", "error"); }
        });
      }}
    >
      {DOC_CATEGORIAS.filter((c) => c.value !== "dossie").map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
    </select>
  );
}
