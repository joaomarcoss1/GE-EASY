import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { CASO_STATUS, INCONSISTENCIAS } from "@/lib/constants";
import { num } from "@/lib/format";
import { carregarInconsistencias } from "@/lib/inconsistencias";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Inconsistências" };

const COR = { alta: "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30", media: "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30", baixa: "border-line bg-surface" };

/** Tudo o que está incorreto ou incompleto nos processos, clientes e rotas (o que distorce as métricas). */
export default async function InconsistenciasPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { profile } = await requirePermission("clientes.ver_todos");
  const { tipo } = await searchParams;
  const { todas, resumo } = await carregarInconsistencias(can(profile, "rotas.ver"));
  const ativo = INCONSISTENCIAS.some((i) => i.value === tipo) ? tipo! : null;
  const lista = ativo ? todas.filter((t) => t.chave === ativo) : [];
  const total = todas.length;

  return (
    <>
      <PageHeader
        eyebrow="Administrativo"
        title="Inconsistências"
        description={total ? `${num(total)} ponto(s) para corrigir nos processos, clientes e rotas. Corrigir estes itens deixa as metas e os relatórios exatos.` : "Nenhuma inconsistência encontrada."}
        actions={can(profile, "clientes.exportar") && total > 0 && <LinkButton href="/api/inconsistencias" variant="secondary" prefetch={false}><Download className="h-4 w-4" /> Exportar planilha</LinkButton>}
      />
      {total === 0 ? (
        <Card><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Tudo certo" description="Nenhum processo, cliente ou rota com dados incorretos." /></Card>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {resumo.filter((r) => r.total > 0).map((r) => (
            <Link key={r.value} href={`/administrativo/inconsistencias?tipo=${r.value}`} scroll={false} className={cn("card card-interactive block border p-4", COR[r.gravidade], ativo === r.value && "ring-2 ring-accent-500")}>
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="text-2xl font-bold tabular-nums">{num(r.total)}</span>
              </span>
              <span className="mt-1 block text-xs text-muted">{r.descricao}</span>
            </Link>
          ))}
        </div>
      )}
      {ativo && (
        <Card>
          <CardHeader icon={<ShieldAlert className="h-4 w-4" />} title={optionLabel(INCONSISTENCIAS, ativo)} description={`${num(lista.length)} item(ns)${lista.length > 500 ? " · mostrando 500 (exporte para ver todos)" : ""}`} />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{ativo === "rota_sem_checklist" ? "Rota" : "Cliente"}</th><th>Tipo</th><th>Status</th><th>O que está errado</th></tr></thead>
              <tbody>
                {lista.slice(0, 500).map((i, n) => (
                  <tr key={`${i.caso_id ?? i.cliente_id ?? i.rota_id}-${n}`}>
                    <td>{i.rota_id ? <Link href={`/rotas/${i.rota_id}`} className="font-semibold hover:text-brand-600">{i.cliente_nome}</Link> : i.cliente_id ? <Link href={`/clientes/${i.cliente_id}`} className="font-semibold hover:text-brand-600">{i.cliente_nome}</Link> : i.cliente_nome}</td>
                    <td className="text-sm">{i.tipo ?? "—"}</td>
                    <td>{i.status ? <StatusBadge options={CASO_STATUS} value={i.status} /> : "—"}</td>
                    <td className="text-sm">{i.detalhe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
