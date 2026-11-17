"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import { assinarRota } from "@/lib/actions/rotas";
import { AssinaturaPad } from "@/components/ui/assinatura-pad";
import { useToast } from "@/components/ui/toast";

/** Assinatura do relatório da rota pelo computador (quem ainda não assinou). */
export function AssinarRotaWeb({ rotaId, nome, papel }: { rotaId: string; nome: string; papel: "participante" | "gestor" | "responsavel" }) {
  const [aberto, setAberto] = useState(false);
  const [png, setPng] = useState<Blob | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} className="no-print inline-flex items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
        <PenLine className="h-4 w-4" /> Assinar como {nome}
      </button>
    );
  }
  return (
    <div className="no-print max-w-md space-y-2 rounded-xl border border-line p-3">
      <p className="text-sm">Confirmo as informações desta rota. — <b>{nome}</b></p>
      <AssinaturaPad rotulo="Sua assinatura" onChange={setPng} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setAberto(false)} className="flex-1 rounded-xl border border-line py-2 text-sm font-semibold">Cancelar</button>
        <button
          type="button"
          disabled={!png || pending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => start(async () => {
            const fd = new FormData();
            fd.set("rota_id", rotaId);
            fd.set("nome", nome);
            fd.set("papel", papel);
            fd.set("assinatura", new File([png!], "assinatura.png", { type: "image/png" }));
            const r = await assinarRota({}, fd);
            if (r.ok) { toast(r.message ?? "Assinado."); setAberto(false); router.refresh(); } else toast(r.error ?? "Não foi possível assinar.", "error");
          })}
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Assinar
        </button>
      </div>
    </div>
  );
}
