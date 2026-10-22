"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CADASTRO_STATUS, CARTEIRAS, type Option } from "@/lib/constants";
import { redistribuirClientes } from "@/lib/actions/ciclo";
import { StatusBadge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export interface LinhaBase {
  id: string;
  nome: string;
  documento: string;
  cidade: string;
  carteira: string;
  status_cadastro: string;
  responsavel: string;
  prazo: string;
}

/** Base de clientes com seleção para redistribuição em lote (para um consultor ou para a base administrativa). */
export function BaseTabela({ linhas, consultores, podeRedistribuir }: { linhas: LinhaBase[]; consultores: Option[]; podeRedistribuir: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [state, action] = useActionState(redistribuirClientes, {});
  const toast = useToast();
  const router = useRouter();
  const last = useRef(state);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) {
      toast(state.message ?? "Concluído.");
      setSel(new Set());
      router.refresh();
    } else if (state.error) toast(state.error, "error");
  }, [state, toast, router]);
  const todos = linhas.length > 0 && sel.size === linhas.length;
  const alternar = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <form action={action}>
      {podeRedistribuir && sel.size > 0 && (
        <div className="flex flex-col gap-2 border-b border-line bg-brand-50/60 p-4 sm:flex-row sm:items-end dark:bg-brand-900/20">
          <p className="text-sm font-semibold sm:mr-2">{sel.size} selecionado(s)</p>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Destino</span>
            <select name="consultor_id" className="input h-10 min-w-[220px]" defaultValue="">
              <option value="">Base administrativa</option>
              {consultores.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="flex-1 text-sm">
            <span className="mb-1 block text-xs text-muted">Motivo (obrigatório)</span>
            <input name="motivo" required maxLength={500} className="input h-10 w-full" placeholder="Ex.: redistribuição da carteira da região Sul" />
          </label>
          <SubmitButton variant="accent">Redistribuir</SubmitButton>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {podeRedistribuir && <th className="w-10"><input type="checkbox" aria-label="Selecionar todos" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(linhas.map((l) => l.id)))} /></th>}
              <th>Cliente</th><th>Cidade</th><th>Carteira</th><th>Responsável</th><th>Situação</th><th>Prazo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                {podeRedistribuir && <td><input type="checkbox" name="ids[]" value={l.id} checked={sel.has(l.id)} onChange={() => alternar(l.id)} aria-label={`Selecionar ${l.nome}`} /></td>}
                <td><Link href={`/clientes/${l.id}`} className="font-medium hover:text-brand-600">{l.nome}</Link><div className="text-xs text-muted">{l.documento}</div></td>
                <td className="text-sm">{l.cidade}</td>
                <td><StatusBadge options={CARTEIRAS} value={l.carteira} /></td>
                <td className="text-sm">{l.responsavel}</td>
                <td><StatusBadge options={CADASTRO_STATUS} value={l.status_cadastro} /></td>
                <td className="whitespace-nowrap text-xs text-muted">{l.prazo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
