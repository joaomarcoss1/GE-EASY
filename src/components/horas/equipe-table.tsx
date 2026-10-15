"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Receipt } from "lucide-react";
import { date } from "@/lib/format";
import type { ActionState } from "@/lib/actions/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export interface HoraRow {
  id: string;
  data: string;
  minutos: number;
  descricao: string;
  usuario: string;
  cliente: string | null;
  processo: string | null;
  faturavel: boolean;
  faturado: boolean;
}

const fmt = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** Horas da equipe com seleção para faturamento. */
export function EquipeHorasTable({ rows, faturar }: { rows: HoraRow[]; faturar: (ids: string[]) => Promise<ActionState> }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const pend = rows.filter((r) => r.faturavel && !r.faturado);
  const minSel = rows.filter((r) => sel.has(r.id)).reduce((a, r) => a + r.minutos, 0);
  return (
    <>
      {sel.size > 0 && (
        <div className="flex items-center justify-between border-b border-line bg-brand-50 px-5 py-2.5 text-sm dark:bg-brand-900/40">
          <span>
            <b>{sel.size}</b> lançamento(s) · <b>{fmt(minSel)}</b>
          </span>
          <Button
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await faturar([...sel]);
                if (r.ok) {
                  toast(r.message ?? "Faturado.");
                  setSel(new Set());
                  router.refresh();
                } else toast(r.error ?? "Erro ao faturar.", "error");
              })
            }
          >
            <Receipt className="h-4 w-4" /> Faturar selecionadas
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" aria-label="Selecionar pendentes" checked={pend.length > 0 && pend.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(pend.map((r) => r.id)) : new Set())} />
              </th>
              <th>Data</th>
              <th>Profissional</th>
              <th>Atividade</th>
              <th>Cliente / processo</th>
              <th className="text-right">Duração</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.faturavel && !r.faturado && (
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
                <td className="text-sm">{date(r.data)}</td>
                <td className="text-sm">{r.usuario}</td>
                <td className="max-w-[280px] truncate text-sm">{r.descricao}</td>
                <td className="text-xs">
                  <div className="truncate">{r.cliente ?? "—"}</div>
                  {r.processo && <div className="truncate text-muted">{r.processo}</div>}
                </td>
                <td className="text-right font-semibold tabular-nums">{fmt(r.minutos)}</td>
                <td>{r.faturado ? <Badge tone="green">Faturada</Badge> : r.faturavel ? <Badge tone="amber">A faturar</Badge> : <Badge tone="slate">Não faturável</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
