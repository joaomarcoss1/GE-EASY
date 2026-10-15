"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { brl, date, daysUntil } from "@/lib/format";
import type { ActionState } from "@/lib/actions/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef, Values } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export interface LancRow {
  id: string;
  tipo: "receita" | "despesa";
  categoria: string;
  descricao: string;
  valor: number;
  vencimento: string;
  data_pagamento: string | null;
  status: "aberto" | "pago" | "cancelado";
  cliente: { id: string; nome: string } | null;
  processo: { id: string; titulo: string } | null;
  parcela: number | null;
  total_parcelas: number | null;
  reembolsavel: boolean;
  values: Values;
}

export function LancamentosTable({
  rows,
  editFields,
  canManage,
  actions,
}: {
  rows: LancRow[];
  editFields: { receita: FieldDef[]; despesa: FieldDef[] };
  canManage: boolean;
  actions: {
    save: (s: ActionState, f: FormData) => Promise<ActionState>;
    baixar: (id: string) => Promise<ActionState>;
    estornar: (id: string) => Promise<ActionState>;
    cancelar: (id: string) => Promise<ActionState>;
    remove: (id: string) => Promise<ActionState>;
    lote: (ids: string[]) => Promise<ActionState>;
  };
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const run = (fn: () => Promise<ActionState>, clear = false) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message ?? "Feito.");
        if (clear) setSel(new Set());
        router.refresh();
      } else toast(r.error ?? "Não foi possível concluir.", "error");
    });
  const abertos = rows.filter((r) => r.status === "aberto");
  const totalSel = rows.filter((r) => sel.has(r.id)).reduce((a, r) => a + r.valor, 0);

  return (
    <>
      {canManage && sel.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-brand-50 px-5 py-2.5 text-sm dark:bg-brand-900/40">
          <span>
            <b>{sel.size}</b> selecionado(s) · <b>{brl(totalSel)}</b>
          </span>
          <Button size="sm" loading={pending} onClick={() => run(() => actions.lote([...sel]), true)}>
            <CheckCircle2 className="h-4 w-4" /> Dar baixa
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canManage && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos em aberto"
                    className="h-4 w-4 accent-brand-700"
                    checked={abertos.length > 0 && abertos.every((r) => sel.has(r.id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(abertos.map((r) => r.id)) : new Set())}
                  />
                </th>
              )}
              <th>Vencimento</th>
              <th>Descrição</th>
              <th>Cliente / processo</th>
              <th className="text-right">Valor</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = daysUntil(r.vencimento);
              const atrasado = r.status === "aberto" && d < 0;
              return (
                <tr key={r.id} className={cn(atrasado && "bg-red-50/60 dark:bg-red-950/20", r.status === "cancelado" && "opacity-50")}>
                  {canManage && (
                    <td>
                      {r.status === "aberto" && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-700"
                          aria-label="Selecionar"
                          checked={sel.has(r.id)}
                          onChange={(e) =>
                            setSel((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.id);
                              else n.delete(r.id);
                              return n;
                            })
                          }
                        />
                      )}
                    </td>
                  )}
                  <td className="text-sm">
                    <div className="font-medium">{date(r.vencimento)}</div>
                    {atrasado && <div className="text-xs font-semibold text-red-600">atrasado há {-d} dia(s)</div>}
                    {r.status === "aberto" && d >= 0 && d <= 5 && <div className="text-xs text-amber-600">vence em {d} dia(s)</div>}
                  </td>
                  <td className="max-w-[300px]">
                    <div className="truncate text-sm font-medium">{r.descricao}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {r.categoria}
                      {r.parcela && r.total_parcelas && <span>· {r.parcela}/{r.total_parcelas}</span>}
                      {r.reembolsavel && <Badge tone="violet">Reembolsável</Badge>}
                    </div>
                  </td>
                  <td className="text-xs">
                    {r.cliente && (
                      <Link href={`/clientes/${r.cliente.id}`} className="block truncate hover:text-brand-600">
                        {r.cliente.nome}
                      </Link>
                    )}
                    {r.processo && (
                      <Link href={`/processos/${r.processo.id}`} className="block truncate text-muted hover:text-brand-600">
                        {r.processo.titulo}
                      </Link>
                    )}
                    {!r.cliente && !r.processo && <span className="text-muted">—</span>}
                  </td>
                  <td className={cn("text-right font-semibold tabular-nums", r.tipo === "receita" ? "text-emerald-600" : "text-fg")}>{brl(r.valor)}</td>
                  <td>
                    {r.status === "pago" ? (
                      <Badge tone="green" dot>
                        {r.tipo === "receita" ? "Recebido" : "Pago"} {r.data_pagamento ? date(r.data_pagamento) : ""}
                      </Badge>
                    ) : r.status === "cancelado" ? (
                      <Badge tone="slate">Cancelado</Badge>
                    ) : (
                      <Badge tone={atrasado ? "red" : "amber"} dot>
                        Em aberto
                      </Badge>
                    )}
                  </td>
                  <td>
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        {r.status === "aberto" && (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => actions.baixar(r.id))}>
                            Baixar
                          </Button>
                        )}
                        {r.status === "pago" && (
                          <Button size="icon" variant="ghost" disabled={pending} title="Estornar baixa" aria-label="Estornar baixa" onClick={() => run(() => actions.estornar(r.id))}>
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        <FormDrawerButton action={actions.save} fields={editFields[r.tipo]} values={r.values} hidden={{ id: r.id }} title="Editar lançamento" icon="edit" size="icon" variant="ghost" width="max-w-2xl" />
                        {r.status === "aberto" && (
                          <Button size="icon" variant="ghost" disabled={pending} title="Cancelar" aria-label="Cancelar" onClick={() => run(() => actions.cancelar(r.id))}>
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" disabled={pending} title="Excluir" aria-label="Excluir" onClick={() => confirm("Excluir este lançamento?") && run(() => actions.remove(r.id))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
