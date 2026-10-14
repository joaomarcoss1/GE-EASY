"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { renovarApolice } from "@/lib/actions/seguros";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";

/** Gera a renovação da apólice e abre a nova proposta criada. */
export function RenovarButton({ id, fimVigencia }: { id: string; fimVigencia: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  return (
    <>
      <Button type="button" variant="accent" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" /> Renovar
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Gerar renovação?">
        <p className="text-sm text-muted">
          Será criada uma nova apólice como <b className="text-fg">proposta</b>, com os mesmos dados e vigência de 1 ano a partir de <b className="text-fg">{fimVigencia}</b>. A apólice atual será marcada como renovada.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await renovarApolice(id);
                if (r.ok && r.id) {
                  toast(r.message ?? "Renovação gerada.");
                  setOpen(false);
                  router.push(`/seguros/${r.id}`);
                } else if (r.id) {
                  toast(r.error ?? "Esta apólice já possui renovação.", "info");
                  setOpen(false);
                  router.push(`/seguros/${r.id}`);
                } else toast(r.error ?? "Não foi possível gerar a renovação.", "error");
              })
            }
          >
            Gerar renovação
          </Button>
        </div>
      </Modal>
    </>
  );
}
