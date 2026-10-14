"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, HandCoins, X } from "lucide-react";
import { COMISSAO_STATUS, LINHAS } from "@/lib/constants";
import { brl, date, pct } from "@/lib/format";
import { bulkSetStatus, updateComissao } from "@/lib/actions/comissoes";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import type { FieldDef } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

export interface ComissaoView {
  id: string;
  linha: "consorcio" | "seguro";
  descricao: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  consultor_nome: string | null;
  competencia: string;
  base_calculo: number;
  percentual_corretora: number;
  valor_corretora: number;
  percentual_consultor: number;
  valor_consultor: number;
  status: "prevista" | "recebida" | "paga" | "estornada";
  data_recebimento: string | null;
  data_pagamento: string | null;
  observacoes: string | null;
}

const editFields: FieldDef[] = [
  { name: "status", label: "Status", type: "select", options: COMISSAO_STATUS, emptyOption: false, span: 6 },
  { name: "data_recebimento", label: "Recebida da administradora/seguradora em", type: "date", span: 3, help: "Preenchida com hoje se vazia ao marcar como recebida" },
  { name: "data_pagamento", label: "Paga ao consultor em", type: "date", span: 3, help: "Preenchida com hoje se vazia ao marcar como paga" },
  { name: "percentual_consultor", label: "% do consultor", type: "percent", span: 3, help: "Sobre o valor da corretora; recalcula o repasse" },
  { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6 },
];

const sumOf = (rows: ComissaoView[], k: "valor_corretora" | "valor_consultor" | "base_calculo") => rows.reduce((a, r) => a + r[k], 0);

export function ComissoesTable({ rows, canManage }: { rows: ComissaoView[]; canManage: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const selectable = useMemo(() => rows.filter((r) => r.status !== "estornada"), [rows]);
  const selRows = rows.filter((r) => selected.has(r.id));
  const allChecked = selectable.length > 0 && selectable.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectable.map((r) => r.id)));

  const apply = (status: "recebida" | "paga") =>
    start(async () => {
      const r = await bulkSetStatus([...selected], status);
      if (r.ok) {
        toast(r.message ?? "Atualizado.");
        setSelected(new Set());
        router.refresh();
      } else toast(r.error ?? "Não foi possível atualizar.", "error");
    });

  return (
    <div className="relative">
      {canManage && selected.size > 0 && (
        <div className="sticky top-16 z-10 flex flex-wrap items-center gap-3 border-b border-brand-200 bg-brand-50/95 px-4 py-2.5 backdrop-blur dark:border-brand-800 dark:bg-brand-950/90">
          <span className="text-sm font-semibold text-brand-800 dark:text-brand-100">
            {selected.size} selecionada(s) · corretora {brl(sumOf(selRows, "valor_corretora"))} · consultores {brl(sumOf(selRows, "valor_consultor"))}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={pending} onClick={() => apply("recebida")}>
              <CheckCircle2 className="h-4 w-4" /> Marcar recebida
            </Button>
            <Button size="sm" variant="accent" loading={pending} onClick={() => apply("paga")}>
              <HandCoins className="h-4 w-4" /> Marcar paga
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canManage && (
                <th className="w-10">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 rounded accent-brand-700" aria-label="Selecionar todas" />
                </th>
              )}
              <th>Negócio / cliente</th>
              <th>Consultor</th>
              <th className="text-right">Base</th>
              <th className="text-right">Corretora</th>
              <th className="text-right">Consultor</th>
              <th>Status</th>
              <th>Datas</th>
              {canManage && <th className="w-12" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-brand-50/60 dark:bg-brand-900/20" : undefined}>
                {canManage && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      disabled={r.status === "estornada"}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 rounded accent-brand-700 disabled:opacity-30"
                      aria-label={`Selecionar ${r.descricao ?? "comissão"}`}
                    />
                  </td>
                )}
                <td className="max-w-[320px]">
                  <div className="flex items-center gap-2">
                    <Badge tone={r.linha === "consorcio" ? "brand" : "accent"}>{LINHAS.find((l) => l.value === r.linha)?.label}</Badge>
                    <span className="truncate font-medium">{r.descricao ?? "—"}</span>
                  </div>
                  {r.cliente_id ? (
                    <Link href={`/clientes/${r.cliente_id}`} className="mt-0.5 block truncate text-xs text-muted hover:text-brand-600">
                      {r.cliente_nome ?? "Cliente"}
                    </Link>
                  ) : (
                    <span className="mt-0.5 block text-xs text-muted">Sem cliente vinculado</span>
                  )}
                </td>
                <td className="text-sm">{r.consultor_nome ?? <span className="text-muted">—</span>}</td>
                <td className="text-right tabular-nums">{brl(r.base_calculo)}</td>
                <td className="text-right tabular-nums">
                  <span className="font-semibold">{brl(r.valor_corretora)}</span>
                  <span className="block text-[11px] text-muted">{pct(r.percentual_corretora, 3)}</span>
                </td>
                <td className="text-right tabular-nums">
                  <span className="font-semibold">{brl(r.valor_consultor)}</span>
                  <span className="block text-[11px] text-muted">{pct(r.percentual_consultor, 3)}</span>
                </td>
                <td>
                  <StatusBadge options={COMISSAO_STATUS} value={r.status} />
                </td>
                <td className="whitespace-nowrap text-xs text-muted">
                  <span className="block">Receb.: {date(r.data_recebimento)}</span>
                  <span className="block">Pagto.: {date(r.data_pagamento)}</span>
                </td>
                {canManage && (
                  <td>
                    <FormDrawerButton
                      action={updateComissao}
                      fields={editFields}
                      hidden={{ id: r.id }}
                      values={{
                        status: r.status,
                        data_recebimento: r.data_recebimento,
                        data_pagamento: r.data_pagamento,
                        percentual_consultor: r.percentual_consultor,
                        observacoes: r.observacoes,
                      }}
                      title="Editar comissão"
                      description={`${r.descricao ?? "Comissão"} · corretora ${brl(r.valor_corretora)}`}
                      icon="edit"
                      variant="ghost"
                      size="icon"
                      width="max-w-xl"
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line bg-surface-2 text-sm font-semibold">
              {canManage && <td className="px-4 py-3" />}
              <td className="px-4 py-3">Total ({rows.length})</td>
              <td className="px-4 py-3" />
              <td className="px-4 py-3 text-right tabular-nums">{brl(sumOf(rows, "base_calculo"))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{brl(sumOf(rows, "valor_corretora"))}</td>
              <td className="px-4 py-3 text-right tabular-nums">{brl(sumOf(rows, "valor_consultor"))}</td>
              <td className="px-4 py-3" colSpan={canManage ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Extrato do consultor: só os valores de repasse dele. */
export function ExtratoTable({ rows }: { rows: ComissaoView[] }) {
  const total = sumOf(
    rows.filter((r) => r.status !== "estornada"),
    "valor_consultor",
  );
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Negócio / cliente</th>
            <th>Linha</th>
            <th className="text-right">Base</th>
            <th className="text-right">Seu %</th>
            <th className="text-right">Sua comissão</th>
            <th>Status</th>
            <th>Pago em</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="max-w-[340px]">
                <span className="block truncate font-medium">{r.descricao ?? "—"}</span>
                {r.cliente_id ? (
                  <Link href={`/clientes/${r.cliente_id}`} className="block truncate text-xs text-muted hover:text-brand-600">
                    {r.cliente_nome ?? "Cliente"}
                  </Link>
                ) : null}
              </td>
              <td>
                <StatusBadge options={LINHAS} value={r.linha} />
              </td>
              <td className="text-right tabular-nums">{brl(r.base_calculo)}</td>
              <td className="text-right tabular-nums text-muted">{pct(r.percentual_consultor, 3)}</td>
              <td className={`text-right font-semibold tabular-nums ${r.status === "estornada" ? "text-muted line-through" : ""}`}>{brl(r.valor_consultor)}</td>
              <td>
                <StatusBadge options={COMISSAO_STATUS} value={r.status} />
              </td>
              <td className="text-xs text-muted">{date(r.data_pagamento)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-surface-2 text-sm font-semibold">
            <td className="px-4 py-3" colSpan={4}>
              Total do extrato (sem estornos)
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{brl(total)}</td>
            <td className="px-4 py-3" colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
