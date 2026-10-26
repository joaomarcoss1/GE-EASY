"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { Tone } from "@/lib/constants";

export interface AuditItem {
  id: number;
  created_at: string;
  actor: string;
  acao: string;
  tabela: string;
  tabelaLabel: string;
  registro_id: string | null;
  dados_antigos: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
}

const ACAO: Record<string, { label: string; tone: Tone }> = {
  INSERT: { label: "Criação", tone: "green" },
  UPDATE: { label: "Alteração", tone: "sky" },
  DELETE: { label: "Exclusão definitiva", tone: "red" },
  EXCLUSAO: { label: "Exclusão (lixeira)", tone: "red" },
  RESTAURACAO: { label: "Restauração", tone: "violet" },
  ACESSO_NEGADO: { label: "Acesso negado", tone: "amber" },
  TROCA_EMPRESA: { label: "Troca de empresa", tone: "slate" },
};
const COMO_ALTERACAO = new Set(["UPDATE", "EXCLUSAO", "RESTAURACAO"]);

const NOISE = new Set(["updated_at"]);

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function diff(item: AuditItem) {
  const before = item.dados_antigos ?? {};
  const after = item.dados_novos ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOISE.has(k));
  return keys
    .filter((k) => {
      if (COMO_ALTERACAO.has(item.acao)) return JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null);
      const v = item.acao === "DELETE" ? before[k] : after[k];
      return v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
    })
    .map((k) => ({ key: k, old: item.acao === "INSERT" ? undefined : before[k], new: item.acao === "DELETE" ? undefined : after[k] }));
}

/** Lista de auditoria com visão expandível das alterações (antes → depois). */
export function AuditLogList({ items }: { items: AuditItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-8" />
            <th>Data</th>
            <th>Usuário</th>
            <th>Ação</th>
            <th>Tabela</th>
            <th>Registro</th>
            <th>Campos</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const changes = diff(it);
            const isOpen = open === it.id;
            const a = ACAO[it.acao] ?? { label: it.acao, tone: "slate" as Tone };
            return (
              <Fragment key={it.id}>
                <tr className={cn("cursor-pointer", isOpen && "bg-surface-2/60")} onClick={() => setOpen(isOpen ? null : it.id)}>
                  <td>
                    <button type="button" aria-expanded={isOpen} aria-label={isOpen ? "Recolher detalhes" : "Ver detalhes"} className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-surface-2 sm:h-7 sm:w-7">
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="whitespace-nowrap text-xs">{dateTime(it.created_at)}</td>
                  <td className="max-w-[220px] truncate text-sm">{it.actor}</td>
                  <td>
                    <Badge tone={a.tone}>{a.label}</Badge>
                  </td>
                  <td className="text-sm">{it.tabelaLabel}</td>
                  <td className="font-mono text-[11px] text-muted">{it.registro_id ? `${it.registro_id.slice(0, 8)}…` : "—"}</td>
                  <td className="max-w-[260px] truncate text-xs text-muted">{changes.map((c) => c.key).join(", ") || "—"}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} className="bg-surface-2/40 !p-0">
                      <div className="px-5 py-4">
                        {it.registro_id && <p className="mb-3 font-mono text-[11px] text-muted">ID: {it.registro_id}</p>}
                        {changes.length === 0 ? (
                          <p className="text-sm text-muted">Nenhum campo relevante alterado.</p>
                        ) : (
                          <dl className="grid gap-2">
                            {changes.map((c) => (
                              <div key={c.key} className="grid gap-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs sm:grid-cols-[180px_1fr]">
                                <dt className="font-mono font-semibold text-fg/80">{c.key}</dt>
                                <dd className="flex min-w-0 flex-wrap items-center gap-2">
                                  {it.acao !== "INSERT" && <span className="max-w-full break-all rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-300 dark:bg-red-950/40 dark:text-red-300">{fmt(c.old)}</span>}
                                  {it.acao === "UPDATE" && <span className="text-muted">→</span>}
                                  {it.acao !== "DELETE" && <span className="max-w-full break-all rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{fmt(c.new)}</span>}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
