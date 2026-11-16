"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { alterarStatusCaso } from "@/lib/actions/comercial";
import { CASO_STATUS } from "@/lib/constants";
import { useToast } from "@/components/ui/toast";

/** Troca o status do processo na própria lista. */
export function StatusCasoSelect({ casoId, status, podeRestritos }: { casoId: string; status: string; podeRestritos: boolean }) {
  const [valor, setValor] = useState(status);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label="Status do processo"
        value={valor}
        disabled={pending}
        className="input h-8 w-auto py-0 pr-7 text-xs"
        onChange={(e) => {
          const novo = e.target.value;
          const restrito = ["pendencia", "exigencia", "em_analise"].includes(novo);
          if (restrito && !podeRestritos && !window.confirm("Com este status o processo só fica visível para os funcionários autorizados. Você deixará de vê-lo. Continuar?")) return;
          const anterior = valor;
          setValor(novo);
          start(async () => {
            const r = await alterarStatusCaso(casoId, novo);
            if (r.ok) {
              toast(r.message ?? "Status atualizado.");
              router.refresh();
            } else {
              setValor(anterior);
              toast(r.error ?? "Não foi possível alterar.", "error");
            }
          });
        }}
      >
        {CASO_STATUS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
    </span>
  );
}
