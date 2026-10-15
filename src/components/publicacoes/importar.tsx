"use client";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileInput, Upload } from "lucide-react";
import { dividirPublicacoes } from "@/lib/juridico/publicacoes";
import { todayISO } from "@/lib/format";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SubmitButton } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/** Importação em lote: cola o texto do Diário, pré-visualiza os blocos e números CNJ detectados. */
export function ImportarPublicacoes({ action }: { action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [state, formAction] = useActionState(action, {});
  const router = useRouter();
  const toast = useToast();
  const blocos = useMemo(() => dividirPublicacoes(texto), [texto]);

  useEffect(() => {
    if (state.ok) {
      toast(state.message ?? "Importado.");
      setOpen(false);
      setTexto("");
      router.refresh();
    } else if (state.error) toast(state.error, "error");
  }, [state, toast, router]);

  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" /> Importar publicações
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Importar publicações" description="Cole o texto do Diário de Justiça (DJe) ou do serviço de recortes. O sistema separa por processo e vincula pelo número CNJ." width="max-w-3xl">
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="pub-data">Data da publicação *</label>
              <input id="pub-data" name="data_publicacao" type="date" defaultValue={todayISO()} required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="pub-disp">Disponibilização</label>
              <input id="pub-disp" name="data_disponibilizacao" type="date" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="pub-fonte">Fonte</label>
              <input id="pub-fonte" name="fonte" placeholder="Ex.: DJe TJSP" className="input" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pub-texto">Texto das publicações *</label>
            <textarea id="pub-texto" name="texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={12} className="input font-mono text-xs" placeholder="Cole aqui o conteúdo. Separe as publicações com uma linha em branco." />
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <FileInput className="h-4 w-4 text-brand-600" /> Pré-visualização: {blocos.length} publicação(ões) · {blocos.filter((b) => b.numero).length} com número CNJ
            </p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {blocos.slice(0, 50).map((b, i) => (
                <li key={i} className="truncate">
                  <span className="mr-2 font-mono font-semibold">{b.numero ?? "sem número"}</span>
                  <span className="text-muted">{b.conteudo.slice(0, 140)}</span>
                </li>
              ))}
              {!blocos.length && <li className="text-muted">Cole o texto para ver como ele será dividido.</li>}
            </ul>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton variant="accent">Importar {blocos.length || ""}</SubmitButton>
          </div>
        </form>
      </Drawer>
    </>
  );
}
