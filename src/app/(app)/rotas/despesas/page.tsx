import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap, pageRange } from "@/lib/data";
import { DESPESA_STATUS, DESPESA_TIPOS } from "@/lib/constants";
import { brl, date } from "@/lib/format";
import type { DespesaRota } from "@/lib/types";
import { decidirDespesa, lancarDespesa } from "@/lib/actions/rotas";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";

export const metadata: Metadata = { title: "Despesas de rota" };

/** Despesas de rota: o consultor lança com comprovante (pelo app); o supervisor/administrativo aprova ou recusa com motivo. */
export default async function DespesasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireSession();
  const aprova = can(profile, "despesas.aprovar");
  if (!aprova && !can(profile, "despesas.lancar")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page, 30);
  const supabase = await createClient();
  const status = sp.status && DESPESA_STATUS.some((s) => s.value === sp.status) ? sp.status : aprova ? "lancada" : null;
  let q = supabase.from("despesas_rota").select("*, rotas(nome)", { count: "estimated" }).order("data", { ascending: false }).range(from, to);
  if (status) q = q.eq("status", status);
  if (!aprova) q = q.eq("consultor_id", userId);
  const [{ data, count }, profiles, { data: rotas }] = await Promise.all([
    q, getProfileMap(),
    supabase.from("rotas").select("id, nome, data").eq("consultor_id", userId).in("status", ["planejada", "em_andamento", "concluida"]).order("data", { ascending: false }).limit(20),
  ]);
  const despesas = (data ?? []) as (DespesaRota & { rotas: { nome: string } | null })[];
  const total = despesas.reduce((a, d) => a + Number(d.valor), 0);
  const caminhos = despesas.map((d) => d.comprovante_path).filter((x): x is string => !!x);
  const { data: urls } = caminhos.length ? await supabase.storage.from("documentos").createSignedUrls(caminhos, 600) : { data: [] };
  const urlDe = new Map((urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path ?? "", u.signedUrl as string]));

  return (
    <>
      <PageHeader
        eyebrow="Campo"
        title="Despesas de rota"
        description={aprova ? "Aprove ou recuse as despesas lançadas pelos consultores. Aprovadas entram no custo da rota e viram reembolso no financeiro." : "Suas despesas de rota e a situação de cada uma."}
        actions={can(profile, "despesas.lancar") && (
          <FormDrawerButton action={lancarDespesa} title="Lançar despesa" label="Lançar despesa" variant="accent" width="max-w-md"
            description="Pelo app de campo você anexa a foto do comprovante."
            values={{ tipo: "combustivel" }}
            fields={[
              { name: "rota_id", label: "Rota", type: "select", options: (rotas ?? []).map((r) => ({ value: r.id, label: `${date(r.data)} · ${r.nome}` })), span: 6 },
              { name: "tipo", label: "Tipo", type: "select", options: DESPESA_TIPOS, emptyOption: false, span: 3 },
              { name: "valor", label: "Valor", type: "money", required: true, span: 3 },
              { name: "data", label: "Data", type: "date", span: 3 },
              { name: "hodometro", label: "Hodômetro", type: "number", min: 0, span: 3 },
              { name: "descricao", label: "Descrição", type: "textarea", rows: 2, span: 6 },
            ]} />
        )}
      />
      <Card>
        <CardHeader title={`${despesas.length} despesa(s) · ${brl(total)}`} icon={<Receipt className="h-4 w-4" />} />
        <div className="border-b border-line p-4"><Suspense><FilterSelect param="status" options={DESPESA_STATUS} allLabel="Todas as situações" /></Suspense></div>
        {despesas.length === 0 ? <EmptyState title="Nenhuma despesa" /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Data</th><th>Consultor</th><th>Rota</th><th>Tipo</th><th className="text-right">Valor</th><th>Comprovante</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {despesas.map((d) => (
                <tr key={d.id}>
                  <td className="text-sm">{date(d.data)}</td>
                  <td className="text-sm">{profiles.get(d.consultor_id)?.full_name ?? "—"}</td>
                  <td className="text-sm">{d.rota_id ? <Link href={`/rotas/${d.rota_id}`} className="hover:text-brand-600">{d.rotas?.nome ?? "Rota"}</Link> : "—"}</td>
                  <td className="text-sm">{optionLabel(DESPESA_TIPOS, d.tipo)}{d.descricao && <div className="text-xs text-muted">{d.descricao}</div>}</td>
                  <td className="text-right font-semibold">{brl(d.valor)}</td>
                  <td className="text-sm">{d.comprovante_path && urlDe.get(d.comprovante_path) ? <a href={urlDe.get(d.comprovante_path)} target="_blank" rel="noopener noreferrer" className="text-brand-600">ver</a> : <span className="text-xs text-amber-600">sem foto</span>}</td>
                  <td><StatusBadge options={DESPESA_STATUS} value={d.status} />{d.motivo && <div className="text-xs text-muted">{d.motivo}</div>}</td>
                  <td className="text-right">
                    {aprova && d.status === "lancada" && d.consultor_id !== userId && (
                      <FormDrawerButton action={decidirDespesa} hidden={{ id: d.id }} title="Analisar despesa" label="Analisar" size="sm" variant="secondary" icon="none" width="max-w-md"
                        values={{ decisao: "aprovar" }}
                        fields={[
                          { name: "decisao", label: "Decisão", type: "select", options: [{ value: "aprovar", label: "Aprovar" }, { value: "recusar", label: "Recusar" }], emptyOption: false, span: 6 },
                          { name: "motivo", label: "Motivo (obrigatório na recusa)", type: "textarea", rows: 3, span: 6 },
                        ]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}
