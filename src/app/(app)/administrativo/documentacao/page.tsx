import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, FileCheck2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap, pageRange } from "@/lib/data";
import { DOC_ANALISE, DOC_CATEGORIAS } from "@/lib/constants";
import { date, dateTime, todayISO } from "@/lib/format";
import { analisarDocumento, aprovarDocumento } from "@/lib/actions/ciclo";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, SegmentTabs } from "@/components/ui/filters";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { DocumentoActions } from "@/components/documentos/documento-actions";
import { DocIcon } from "@/components/documentos/documentos-table";

export const metadata: Metadata = { title: "Central de documentação" };

const FILAS = [
  { value: "fila", label: "Para analisar" },
  { value: "recusado", label: "Recusados" },
  { value: "vencendo", label: "Vencendo em 30 dias" },
  { value: "vencido", label: "Vencidos" },
  { value: "aprovado", label: "Aprovados" },
];

/** Fila de análise documental: enviado → em análise → aprovado/recusado (com motivo, quem enviou é avisado). */
export default async function DocumentacaoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("documentacao.analisar");
  const sp = await searchParams;
  const fila = FILAS.some((f) => f.value === sp.fila) ? sp.fila! : "fila";
  const { page, size, from, to } = pageRange(sp.page, 30);
  const supabase = await createClient();
  const hoje = todayISO();
  const em30 = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  let q = supabase
    .from("documentos")
    .select("id, nome, categoria, mime_type, created_at, enviado_por, analise_status, analise_motivo, validade, drive_url, cliente_id, clientes(nome, status_cadastro)", { count: "exact" })
    .not("cliente_id", "is", null)
    .range(from, to);
  if (fila === "fila") q = q.in("analise_status", ["enviado", "em_analise"]).order("created_at", { ascending: true });
  else if (fila === "vencendo") q = q.eq("analise_status", "aprovado").gte("validade", hoje).lte("validade", em30).order("validade");
  else q = q.eq("analise_status", fila).order("created_at", { ascending: false });
  const [{ data, count }, nomes] = await Promise.all([q, getProfileMap()]);
  const docs = (data ?? []) as unknown as {
    id: string; nome: string; categoria: string; mime_type: string | null; created_at: string; enviado_por: string | null; analise_status: string;
    analise_motivo: string | null; validade: string | null; drive_url: string | null; cliente_id: string; clientes: { nome: string } | { nome: string }[] | null;
  }[];
  const clienteNome = (d: (typeof docs)[number]) => (Array.isArray(d.clientes) ? d.clientes[0]?.nome : d.clientes?.nome) ?? "Cliente";

  return (
    <>
      <PageHeader eyebrow="Administrativo" title="Central de documentação" description="Analise os documentos enviados por consultores e clientes. Ao aprovar o último obrigatório, o cadastro fica completo e sai do prazo." />
      <Card>
        <div className="border-b border-line p-4"><SegmentTabs param="fila" options={FILAS} /></div>
        {docs.length === 0 ? (
          <EmptyState icon={<FileCheck2 className="h-6 w-6" />} title={fila === "fila" ? "Fila vazia" : "Nada por aqui"} description={fila === "fila" ? "Todos os documentos enviados já foram analisados." : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Documento</th><th>Cliente</th><th>Categoria</th><th>Enviado</th><th>Situação</th><th className="text-right">Ações</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><div className="flex min-w-[220px] items-center gap-3"><DocIcon mime={d.mime_type} /><span className="max-w-[260px] truncate font-medium" title={d.nome}>{d.nome}</span></div></td>
                    <td><Link href={`/clientes/${d.cliente_id}`} className="font-medium hover:text-brand-600">{clienteNome(d)}</Link></td>
                    <td><Badge tone="brand">{optionLabel(DOC_CATEGORIAS, d.categoria)}</Badge></td>
                    <td className="text-xs text-muted">{dateTime(d.created_at)}<br />{d.enviado_por ? (nomes.get(d.enviado_por)?.full_name ?? "—") : "—"}</td>
                    <td>
                      <StatusBadge options={DOC_ANALISE} value={d.analise_status} />
                      {d.validade && <div className="mt-1 text-xs text-muted">Válido até {date(d.validade)}</div>}
                      {d.analise_motivo && <div className="mt-1 max-w-[220px] text-xs text-red-600">{d.analise_motivo}</div>}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <DocumentoActions id={d.id} nome={d.nome} driveUrl={d.drive_url} canDelete={false} googleReady={false} />
                        {d.analise_status !== "aprovado" && (
                          <ConfirmAction action={aprovarDocumento} id={d.id} danger={false} variant="secondary" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} label="Aprovar" title="Aprovar documento?" message="Confira se o documento está legível, completo e pertence ao cliente." confirmLabel="Aprovar" />
                        )}
                        {d.analise_status !== "recusado" && (
                          <FormDrawerButton action={analisarDocumento} hidden={{ documento_id: d.id, status: "recusado" }} title="Recusar documento" label="Recusar" icon="none" size="sm" variant="ghost" width="max-w-md"
                            fields={[{ name: "motivo", label: "Motivo da recusa", type: "textarea", rows: 3, required: true, span: 6, placeholder: "Ex.: ilegível, vencido, falta o verso" }]} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}
