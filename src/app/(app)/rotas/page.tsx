import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Map as MapIcon, Receipt, Route } from "lucide-react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { consultorOptions, getProfileMap, pageRange } from "@/lib/data";
import { ROTA_STATUS } from "@/lib/constants";
import { brl, date, num, todayISO } from "@/lib/format";
import type { Rota } from "@/lib/types";
import { salvarRota } from "@/lib/actions/rotas";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Rotas" };

/** Planejamento e acompanhamento de rotas (administrativo); o consultor vê as suas e executa pelo app de campo. */
export default async function RotasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const { profile, userId } = session;
  if (!can(profile, "rotas.ver") && !can(profile, "rotas.executar") && !can(profile, "rotas.definir")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page, 25);
  const supabase = await createClient();
  let q = supabase.from("rotas").select("*", { count: "estimated" }).order("data", { ascending: false }).order("nome").range(from, to);
  if (sp.status && ROTA_STATUS.some((s) => s.value === sp.status)) q = q.eq("status", sp.status);
  if (sp.consultor && /^[0-9a-f-]{36}$/i.test(sp.consultor)) q = q.eq("consultor_id", sp.consultor);
  if (sp.periodo === "hoje") q = q.eq("data", todayISO());
  else if (sp.periodo === "futuras") q = q.gte("data", todayISO());
  const [{ data, count }, profiles, consultores, { data: veiculos }] = await Promise.all([
    q, getProfileMap(), consultorOptions(), supabase.from("veiculos").select("id, descricao, placa").eq("ativo", true).order("descricao"),
  ]);
  const rotas = (data ?? []) as Rota[];
  const planeja = can(profile, "rotas.definir");
  const opVeic = (veiculos ?? []).map((v) => ({ value: v.id, label: v.placa ? `${v.descricao} · ${v.placa}` : v.descricao }));

  return (
    <>
      <PageHeader
        eyebrow="Campo"
        title="Rotas"
        description="Planeje as rotas dos consultores (cidades, clientes, endereços), acompanhe os check-ins e aprove km, tempos e despesas."
        actions={
          <>
            {can(profile, "rotas.ver") && <LinkButton href="/rotas/mapa" variant="secondary"><MapIcon className="h-4 w-4" />Mapa do campo</LinkButton>}
            {(can(profile, "despesas.aprovar") || can(profile, "despesas.lancar")) && <LinkButton href="/rotas/despesas" variant="secondary"><Receipt className="h-4 w-4" />Despesas</LinkButton>}
            {planeja && (
              <FormDrawerButton action={salvarRota} title="Nova rota" label="Nova rota" variant="accent" redirectTo="/rotas/:id" width="max-w-lg"
                values={{ data: todayISO() }}
                fields={[
                  { name: "nome", label: "Nome", required: true, span: 6, placeholder: "Ex.: Rota Centro — documentação" },
                  { name: "data", label: "Data", type: "date", required: true, span: 3 },
                  { name: "consultor_id", label: "Consultor", type: "select", options: consultores, required: true, span: 3 },
                  { name: "veiculo_id", label: "Veículo", type: "select", options: opVeic, span: 6 },
                  { name: "objetivo", label: "Objetivo", type: "textarea", rows: 3, span: 6 },
                ]} />
            )}
          </>
        }
      />
      <Card>
        <CardHeader title="Rotas" icon={<Route className="h-4 w-4" />} />
        <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row">
          <Suspense>
            <FilterSelect param="periodo" options={[{ value: "hoje", label: "Hoje" }, { value: "futuras", label: "De hoje em diante" }]} allLabel="Todo o período" />
            <FilterSelect param="status" options={ROTA_STATUS} allLabel="Todas as situações" />
            {consultores.length > 1 && <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" />}
          </Suspense>
        </div>
        {rotas.length === 0 ? <EmptyState icon={<Route className="h-6 w-6" />} title="Nenhuma rota" description={planeja ? "Crie a primeira rota e inclua as paradas." : "As rotas planejadas para você aparecem aqui e no app de campo."} /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Data</th><th>Rota</th><th>Consultor</th><th>Situação</th><th className="text-right">Km plan./real.</th><th className="text-right">Visitas</th><th className="text-right">Custo</th></tr></thead>
            <tbody>
              {rotas.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-sm">{date(r.data)}</td>
                  <td><Link href={`/rotas/${r.id}`} className="font-medium hover:text-brand-600">{r.nome}</Link>{r.consultor_id === userId && <span className="ml-2 text-xs text-accent-600">sua</span>}</td>
                  <td className="text-sm">{profiles.get(r.consultor_id)?.full_name ?? "—"}</td>
                  <td><StatusBadge options={ROTA_STATUS} value={r.status} /></td>
                  <td className="text-right text-sm">{r.km_planejado != null ? num(r.km_planejado) : "—"} / {r.resumo ? num(r.resumo.km) : "—"}</td>
                  <td className="text-right text-sm">{r.resumo ? `${r.resumo.visitadas}/${r.resumo.paradas}` : "—"}</td>
                  <td className="text-right text-sm">{r.resumo ? brl(r.resumo.custo_total) : "—"}</td>
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
