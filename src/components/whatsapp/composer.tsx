"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { enviarMensagem } from "@/lib/actions/whatsapp";
import type { ActionState } from "@/lib/actions/types";
import { useToast } from "@/components/ui/toast";

type Modelo = { id: string; nome: string; corpo: string; variaveis: number; categoria: string };

/** Caixa de resposta: texto livre dentro da janela de 24 h; fora dela, só modelo aprovado (o banco confere). */
export function Composer({ conversaId, janelaAberta, modelos }: { conversaId: string; janelaAberta: boolean; modelos: Modelo[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(enviarMensagem, {});
  const [modelo, setModelo] = useState(janelaAberta ? "" : modelos[0]?.id ?? "");
  const form = useRef<HTMLFormElement>(null);
  const toast = useToast();
  useEffect(() => {
    if (state.ok) form.current?.reset();
    if (state.error) toast(state.error, "error");
  }, [state, toast]);
  const md = modelos.find((m) => m.id === modelo);
  return (
    <form ref={form} action={action} className="space-y-2 border-t border-line p-3">
      <input type="hidden" name="conversa_id" value={conversaId} />
      {!janelaAberta && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-100">Mais de 24 h sem mensagem do cliente: a Meta só permite iniciar com um modelo aprovado.</p>}
      <div className="flex gap-2">
        <select className="input max-w-56" name="modelo_id" value={modelo} onChange={(e) => setModelo(e.target.value)} aria-label="Modelo">
          {janelaAberta && <option value="">Texto livre</option>}
          {modelos.map((m) => <option key={m.id} value={m.id}>Modelo: {m.nome}</option>)}
        </select>
        {md && md.variaveis > 0 && <input className="input" name="variaveis" placeholder={`${md.variaveis} variável(is) separadas por |`} />}
      </div>
      {md ? <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{md.corpo}</p> : (
        <textarea className="input" name="texto" rows={2} maxLength={4096} placeholder="Escreva a resposta…" required
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.current?.requestSubmit(); } }} />
      )}
      <div className="flex justify-end">
        <button type="submit" disabled={pending || (!janelaAberta && !md)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Enviar
        </button>
      </div>
    </form>
  );
}
