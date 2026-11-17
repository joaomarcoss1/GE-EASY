"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { alterarStatusCaso } from "@/lib/actions/comercial";
import { CASO_STATUS } from "@/lib/constants";
import { useToast } from "@/components/ui/toast";

const RESTRITOS = ["pendencia", "exigencia", "em_analise"];

/** Troca o status do processo na própria lista. Habilitar pede o protocolo do INSS e o estado atual. */
export function StatusCasoSelect({ casoId, status, podeRestritos, protocolo = null, situacao = null }: { casoId: string; status: string; podeRestritos: boolean; protocolo?: string | null; situacao?: string | null }) {
  const [valor, setValor] = useState(status);
  const [habilitar, setHabilitar] = useState(false);
  const [prot, setProt] = useState(protocolo ?? "");
  const [sit, setSit] = useState(situacao ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const enviar = (novo: string, extra?: { protocolo_inss: string; situacao_atual: string }) => {
    const anterior = valor;
    setValor(novo);
    start(async () => {
      const r = await alterarStatusCaso(casoId, novo, extra);
      if (r.ok) {
        toast(r.message ?? "Status atualizado.");
        setHabilitar(false);
        router.refresh();
      } else {
        setValor(anterior);
        toast(r.error ?? "Não foi possível alterar.", "error");
      }
    });
  };

  return (
    <span className="inline-flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1.5">
        <select
          aria-label="Status do processo"
          value={habilitar ? "habilitado" : valor}
          disabled={pending}
          className="input h-8 w-auto py-0 pr-7 text-xs"
          onChange={(e) => {
            const novo = e.target.value;
            if (novo === "habilitado" && !(protocolo && situacao)) {
              setHabilitar(true);
              return;
            }
            setHabilitar(false);
            if (RESTRITOS.includes(novo) && !podeRestritos && !window.confirm("Com este status o processo só fica visível para os funcionários autorizados. Você deixará de vê-lo. Continuar?")) return;
            enviar(novo);
          }}
        >
          {CASO_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
      </span>
      {habilitar && (
        <span className="flex w-64 flex-col gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50/60 p-2 dark:border-emerald-800 dark:bg-emerald-950/30">
          <input className="input h-8 text-xs" placeholder="Protocolo do INSS" value={prot} maxLength={40} onChange={(e) => setProt(e.target.value)} aria-label="Protocolo do INSS" />
          <input className="input h-8 text-xs" placeholder="Estado atual do processo" value={sit} maxLength={300} onChange={(e) => setSit(e.target.value)} aria-label="Estado atual do processo" />
          <span className="flex gap-1.5">
            <button type="button" className="flex-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold" onClick={() => setHabilitar(false)}>Cancelar</button>
            <button
              type="button"
              disabled={pending || !prot.trim() || !sit.trim()}
              className="flex-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => enviar("habilitado", { protocolo_inss: prot.trim(), situacao_atual: sit.trim() })}
            >
              Habilitar
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
