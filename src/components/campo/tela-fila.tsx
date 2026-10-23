"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, Clock, CopyCheck } from "lucide-react";
import { historico, pendentes, type Historico, type ItemFila } from "@/lib/campo/fila";
import { useCampo } from "./contexto";

/** O que está esperando envio (com o motivo da última falha) e o resultado dos últimos envios. */
export function TelaFila() {
  const { fila, sincronizar, sincronizando, online } = useCampo();
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [hist, setHist] = useState<Historico[]>([]);
  useEffect(() => {
    const ler = () => { pendentes().then(setItens); historico().then(setHist); };
    ler();
    window.addEventListener("campo:fila", ler);
    return () => window.removeEventListener("campo:fila", ler);
  }, [fila]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Envios</h1>
        <button type="button" disabled={sincronizando || !online} onClick={sincronizar} className="rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{sincronizando ? "Enviando…" : "Enviar agora"}</button>
      </div>
      <section className="card">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold">Aguardando envio ({itens.length})</p>
        {itens.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Tudo enviado.</p> : (
          <ul className="divide-y divide-line">
            {itens.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <Clock className="mt-0.5 h-4 w-4 text-amber-600" />
                <span className="min-w-0 flex-1"><span className="block">{i.resumo}</span>{i.erro && <span className="block text-xs text-muted">{i.erro} · {i.tentativas} tentativa(s)</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <p className="border-b border-line px-4 py-3 text-sm font-semibold">Últimos envios</p>
        {hist.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Nenhum envio ainda.</p> : (
          <ul className="divide-y divide-line">
            {hist.map((h) => (
              <li key={h.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                {h.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : h.status === "duplicado" ? <CopyCheck className="mt-0.5 h-4 w-4 text-sky-600" /> : <CircleAlert className="mt-0.5 h-4 w-4 text-red-600" />}
                <span className="min-w-0 flex-1"><span className="block">{h.resumo}</span><span className="block text-xs text-muted">{h.mensagem} · {new Date(h.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
