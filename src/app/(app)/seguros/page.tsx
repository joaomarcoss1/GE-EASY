import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, BadgeDollarSign, RefreshCw, Wallet, CalendarClock } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isBackofficeRole } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap, pageRange, parceiroMap, parceiroOptions, produtoOptions, searchTerm } from "@/lib/data";
import { APOLICE_STATUS, RAMOS_SEGURO, type Option } from "@/lib/constants";
import { brl, brlShort, date, daysUntil, num, todayISO } from "@/lib/format";
import type { SeguroApolice } from "@/lib/types";
import { createApolice } from "@/lib/actions/seguros";
import { isUuid } from "@/lib/actions/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, Pagination, SearchInput, SegmentTabs } from "@/components/ui/filters";
import { addDaysISO, addYearISO, apoliceFields, vencimentoLabel, vencimentoTone } from "@/components/seguros/fields";

export const metadata: Metadata = { title: "Seguros" };

type ApoliceRow = SeguroApolice & { clientes: { nome: string } | null };

const VISOES: Option[] = [
  { value: "todas", label: "Todas" },
  { value: "renovacoes", label: "Renovações" },
  { value: "vencidas", label: "Vencidas" },
];

export default async function SegurosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.view");
  const sp = await searchParams;
  const visao = sp.visao === "renovacoes" || sp.visao === "vencidas" ? sp.visao : "todas";
  const { page, size, from, to } = pageRange(sp.page);
  const hoje = todayISO();
  const supabase = await createClient();

  let query = supabase.from("seguro_apolices").select("*, clientes(nome)", { count: "exact" }).range(from, to);
  if (visao === "renovacoes") {
    query = query.eq("status", "vigente").gte("fim_vigencia", hoje).lte("fim_vigencia", addDaysISO(hoje, 60)).order("fim_vigencia", { ascending: true });
  } else if (visao === "vencidas") {
    query = query.in("status", ["vigente", "vencida"]).lt("fim_vigencia", hoje).order("fim_vigencia", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
    if (sp.status) query = query.eq("status", sp.status);
  }
  const q = searchTerm(sp.q);
  if (q) {
    const { data: cls } = await supabase.from("clientes").select("id").ilike("nome", `%${q}%`).limit(200);
    const ids = (cls ?? []).map((c) => c.id as string);
    query = query.or([`numero_apolice.ilike.%${q}%`, `numero_proposta.ilike.%${q}%`, `item_segurado.ilike.%${q}%`, ...(ids.length ? [`cliente_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  if (sp.ramo) query = query.eq("ramo", sp.ramo);
  if (isUuid(sp.seguradora)) query = query.eq("seguradora_id", sp.seguradora);

  const [{ data, count }, { data: resumo }, { data: comissoes }, seguradoras, parceiros, profiles] = await Promise.all([
    query,
    supabase.from("seguro_apolices").select("status, premio_total, fim_vigencia").in("status", ["vigente", "vencida"]).limit(10000),
    supabase.from("comissoes").select("valor_corretora, valor_consultor").eq("linha", "seguro").eq("status", "prevista").limit(10000),
    parceiroOptions("seguradora"),
    parceiroMap(),
    getProfileMap(),
  ]);
  const apolices = (data ?? []) as ApoliceRow[];
  const all = (resumo ?? []) as Pick<SeguroApolice, "status" | "premio_total" | "fim_vigencia">[];
  const vigentes = all.filter((a) => a.status === "vigente" && a.fim_vigencia >= hoje);
  const premioVigente = vigentes.reduce((s, a) => s + Number(a.premio_total), 0);
  const em30 = addDaysISO(hoje, 30);
  const renov30 = vigentes.filter((a) => a.fim_vigencia <= em30).length;
  const vencidas = all.filter((a) => a.fim_vigencia < hoje).length;
  const backoffice = isBackofficeRole(profile.role);
  const comissaoPrevista = (comissoes ?? []).reduce((s, c) => s + Number(backoffice ? c.valor_corretora : c.valor_consultor), 0);

  const canWrite = can(profile.role, "negocios.write");
  const canTransfer = can(profile.role, "clientes.transfer");
  const [clientes, produtos, consultores] = canWrite ? await Promise.all([clienteOptions(), produtoOptions("seguro"), canTransfer ? consultorOptions() : Promise.resolve([])]) : [[], [], []];
  const filtered = Boolean(sp.q || sp.status || sp.ramo || sp.seguradora);

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Seguros"
        description="Apólices, propostas, renovações e sinistros da carteira."
        actions={
          canWrite && (
            <FormDrawerButton
              action={createApolice}
              fields={apoliceFields({ clientes, seguradoras, produtos, consultores, canTransfer })}
              values={{ cliente_id: isUuid(sp.cliente_id) ? sp.cliente_id : undefined, ramo: "auto", status: "cotacao", inicio_vigencia: hoje, fim_vigencia: addYearISO(hoje), parcelas: 1 }}
              title="Novo seguro"
              description="Cotação, proposta ou apólice emitida. A comissão é gerada automaticamente quando a apólice fica vigente."
              label="Novo seguro"
              variant="accent"
              redirectTo="/seguros/:id"
              defaultOpen={sp.novo === "1"}
            />
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Prêmio vigente total" value={brlShort(premioVigente)} hint={brl(premioVigente)} icon={<BadgeDollarSign className="h-5 w-5" />} tone="brand" />
        <StatCard label="Apólices vigentes" value={num(vigentes.length)} hint={vencidas ? `${vencidas} vencida(s) sem renovação` : "nenhuma vencida"} icon={<ShieldCheck className="h-5 w-5" />} tone="green" />
        <StatCard label="Renovações em 30 dias" value={num(renov30)} hint="apólices vigentes a vencer" icon={<RefreshCw className="h-5 w-5" />} tone="accent" />
        <StatCard label="Comissão prevista" value={brlShort(comissaoPrevista)} hint={backoffice ? "corretora · a receber" : "sua parte · a receber"} icon={<Wallet className="h-5 w-5" />} tone="amber" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <SegmentTabs param="visao" options={VISOES} />
          <SearchInput placeholder="Cliente, apólice, proposta, item…" />
          {visao === "todas" && <FilterSelect param="status" options={APOLICE_STATUS} allLabel="Todos os status" />}
          <FilterSelect param="ramo" options={RAMOS_SEGURO} allLabel="Todos os ramos" />
          {seguradoras.length > 0 && <FilterSelect param="seguradora" options={seguradoras} allLabel="Todas as seguradoras" />}
        </div>
        {visao === "renovacoes" && apolices.length > 0 && (
          <div className="flex items-center gap-2 border-b border-line bg-accent-50/60 px-5 py-2.5 text-xs text-accent-800 dark:bg-accent-900/20 dark:text-accent-200">
            <CalendarClock className="h-4 w-4" /> Apólices vigentes que vencem nos próximos 60 dias, das mais urgentes para as mais distantes.
          </div>
        )}
        {apolices.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" />}
            title={visao === "renovacoes" ? "Nenhuma renovação nos próximos 60 dias" : visao === "vencidas" ? "Nenhuma apólice vencida" : "Nenhum seguro encontrado"}
            description={filtered ? "Ajuste os filtros para ver mais resultados." : visao === "todas" ? "Cadastre a primeira cotação ou apólice da carteira." : "Tudo em dia por aqui."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Apólice / item</th>
                  <th>Ramo / seguradora</th>
                  <th>Vigência</th>
                  <th className="text-right">Prêmio total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {apolices.map((a) => {
                  const dias = daysUntil(a.fim_vigencia);
                  const showVence = a.status === "vigente" && dias <= 60;
                  const consultor = a.consultor_id ? profiles.get(a.consultor_id) : null;
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/seguros/${a.id}`} className="flex items-center gap-3">
                          <Avatar name={a.clientes?.nome} size={34} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold hover:text-brand-600">{a.clientes?.nome ?? "Cliente"}</span>
                            {canTransfer && consultor && <span className="block text-xs text-muted">{consultor.full_name}</span>}
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Link href={`/seguros/${a.id}`} className="font-medium hover:text-brand-600">
                          {a.numero_apolice ? `Apólice ${a.numero_apolice}` : a.numero_proposta ? `Proposta ${a.numero_proposta}` : "Sem número"}
                        </Link>
                        {a.item_segurado && <div className="max-w-[240px] truncate text-xs text-muted" title={a.item_segurado}>{a.item_segurado}</div>}
                      </td>
                      <td className="text-sm">
                        <div>{optionLabel(RAMOS_SEGURO, a.ramo)}</div>
                        <div className="text-xs text-muted">{(a.seguradora_id && parceiros.get(a.seguradora_id)) || "—"}</div>
                      </td>
                      <td className="text-xs">
                        <div className="whitespace-nowrap">
                          {date(a.inicio_vigencia)} → {date(a.fim_vigencia)}
                        </div>
                        {showVence && (
                          <Badge tone={dias < 0 ? "red" : vencimentoTone(dias)} className="mt-1">
                            {vencimentoLabel(dias)}
                          </Badge>
                        )}
                      </td>
                      <td className="text-right font-semibold tabular-nums">{brl(a.premio_total)}</td>
                      <td>
                        <StatusBadge options={APOLICE_STATUS} value={a.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}
