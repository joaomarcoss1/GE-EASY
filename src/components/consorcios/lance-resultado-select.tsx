"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { LANCE_RESULTADO } from "@/lib/constants";
import { updateLanceResultado } from "@/lib/actions/consorcios";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";

const toneCls: Record<string, string> = {
  pendente: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  contemplado: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  nao_contemplado: "border-line bg-surface-2 text-muted",
};

/** Seletor rápido do resultado da assembleia, com confirmação ao contemplar. */
export function LanceResultadoSelect({ id, value }: { id: string; value: string }) {
  const [current, setCurrent] = useState(value);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const save = (next: string) =>
    start(async () => {
      const prev = current;
      setCurrent(next);
      const r = await updateLanceResultado(id, next);
      if (r.ok) {
        toast(r.message ?? "Resultado atualizado.");
        setConfirm(false);
        router.refresh();
      } else {
        setCurrent(prev);
        toast(r.error ?? "Não foi possível atualizar.", "error");
      }
    });

  return (
    <>
      <div className="relative inline-flex items-center">
        <select
          value={current}
          disabled={pending}
          onChange={(e) => (e.target.value === "contemplado" ? setConfirm(true) : save(e.target.value))}
          aria-label="Resultado da assembleia"
          className={cn("h-8 cursor-pointer appearance-none rounded-full border py-0 pl-3 pr-7 text-xs font-semibold outline-none transition focus:ring-2 focus:ring-accent-500/40 disabled:opacity-60", toneCls[current])}
        >
          {LANCE_RESULTADO.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {pending ? <Loader2 className="pointer-events-none absolute right-2 h-3.5 w-3.5 animate-spin" /> : <span className="pointer-events-none absolute right-2.5 text-[10px] opacity-60">▼</span>}
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Confirmar contemplação?">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30">
            <Trophy className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted">A cota será marcada como <b className="text-fg">contemplada</b> com a data da assembleia, a forma e o valor deste lance.</p>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Cancelar
          </Button>
          <Button variant="primary" loading={pending} onClick={() => save("contemplado")}>
            Confirmar contemplação
          </Button>
        </div>
      </Modal>
    </>
  );
}
