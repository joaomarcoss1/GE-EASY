import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Wallet, Trophy, FileClock, Calculator } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap, pageRange, parceiroMap, parceiroOptions, produtoOptions, searchTerm } from "@/lib/data";
import { CATEGORIAS_CONSORCIO, COTA_STATUS } from "@/lib/constants";
import { brl, brlShort, date, num, todayISO } from "@/lib/format";
import type { ConsorcioCota } from "@/lib/types";
import { createCota } from "@/lib/actions/consorcios";
import { isUuid } from "@/lib/actions/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { cotaFields } from "@/components/consorcios/fields";

export const metadata: Metadata = { title: "Consórcios" };

type CotaRow = ConsorcioCota & { clientes: { nome: string } | null };

export default async function ConsorciosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.view");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page);
  const supabase = await createClient();

  let query = supabase.from("consorcio_cotas").select("*, clientes(nome)", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const q = searchTerm(sp.q);
  if (q) {
    // Busca por nome do cliente em duas etapas (filtros .or() não alcançam tabelas relacionadas)
    const { data: cls } = await supabase.from("clientes").select("id").ilike("nome", `%${q}%`).limit(200);
    const ids = (cls ?? []).map((c) => c.id as string);
    query = query.or([`grupo.ilike.%${q}%`, `cota.ilike.%${q}%`, `numero_contrato.ilike.%${q}%`, ...(ids.length ? [`cliente_id.in.(${ids.join(",")})`] : [])].join(","));
  }
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.categoria) query = query.eq("categoria", sp.categoria);
  if (isUuid(sp.administradora)) query = query.eq("administradora_id", sp.administradora);

  const ano = todayISO().slice(0, 4);
  const [{ data, count }, { data: resumo }, administradoras, parceiros, profiles] = await Promise.all([
    query,
    supabase.from("consorcio_cotas").select("status, valor_credito, contemplada_em").limit(10000),
    parceiroOptions("administradora"),
    parceiroMap(),
    getProfileMap(),
  ]);
  const cotas = (data ?? []) as CotaRow[];
  const all = (resumo ?? []) as Pick<ConsorcioCota, "status" | "valor_credito" | "contemplada_em">[];

  const ativas = all.filter((c) => c.status === "ativa" || c.status === "contemplada" || c.status === "inadimplente");
  const creditoAtivo = ativas.reduce((a, c) => a + Number(c.valor_credito), 0);
  const nAtivas = all.filter((c) => c.status === "ativa").length;
  const contempladasAno = all.filter((c) => c.contemplada_em && c.contemplada_em.startsWith(ano)).length;
  const propostas = all.filter((c) => c.status === "proposta");

  const canWrite = can(profile.role, "negocios.write");
  const canTransfer = can(profile.role, "clientes.transfer");
  const novo = sp.novo === "1";
  const [clientes, produtos, consultores] = canWrite ? await Promise.all([clienteOptions(), produtoOptions("consorcio"), canTransfer ? consultorOptions() : Promise.resolve([])]) : [[], [], []];
  const filtered = Boolean(sp.q || sp.status || sp.categoria || sp.administradora);

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Consórcios"
        description="Cotas, propostas, assembleias e contemplações da carteira."
        actions={
          <>
            <LinkButton href="/consorcios/simulador" variant="secondary">
              <Calculator className="h-4 w-4" /> Simulador
            </LinkButton>
            {canWrite && (
              <FormDrawerButton
                action={createCota}
                fields={cotaFields({ clientes, administradoras, produtos, consultores, canTransfer })}
                values={{ cliente_id: isUuid(sp.cliente_id) ? sp.cliente_id : undefined, categoria: "imovel", status: "proposta", data_adesao: todayISO(), parcelas_pagas: 0 }}
                title="Nova cota de consórcio"
                description="Cadastre a proposta ou cota já ativa. A comissão é gerada automaticamente quando a cota fica ativa."
                label="Nova cota"
                variant="accent"
                redirectTo="/consorcios/:id"
                defaultOpen={novo}
              />
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crédito ativo total" value={brlShort(creditoAtivo)} hint={`${num(ativas.length)} cota(s) em andamento`} icon={<Wallet className="h-5 w-5" />} tone="brand" />
        <StatCard label="Cotas ativas" value={num(nAtivas)} hint="aguardando contemplação" icon={<Landmark className="h-5 w-5" />} tone="accent" />
        <StatCard label={`Contempladas em ${ano}`} value={num(contempladasAno)} hint="sorteio ou lance" icon={<Trophy className="h-5 w-5" />} tone="green" />
        <StatCard label="Propostas em andamento" value={num(propostas.length)} hint={brl(propostas.reduce((a, c) => a + Number(c.valor_credito), 0))} icon={<FileClock className="h-5 w-5" />} tone="amber" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:flex-wrap lg:items-center">
          <SearchInput placeholder="Cliente, grupo, cota ou contrato…" />
          <FilterSelect param="status" options={COTA_STATUS} allLabel="Todos os status" />
          <FilterSelect param="categoria" options={CATEGORIAS_CONSORCIO} allLabel="Todas as categorias" />
          {administradoras.length > 0 && <FilterSelect param="administradora" options={administradoras} allLabel="Todas as administradoras" />}
        </div>
        {cotas.length === 0 ? (
          <EmptyState
            icon={<Landmark className="h-6 w-6" />}
            title="Nenhuma cota encontrada"
            description={filtered ? "Ajuste os filtros para ver mais resultados." : "Cadastre a primeira proposta de consórcio ou use o simulador para apresentar ao cliente."}
            action={!filtered ? <LinkButton href="/consorcios/simulador" variant="secondary"><Calculator className="h-4 w-4" /> Abrir simulador</LinkButton> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Grupo / cota</th>
                  <th>Administradora</th>
                  <th className="text-right">Crédito</th>
                  <th className="text-right">Parcela</th>
                  <th className="min-w-[150px]">Pagamento</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {cotas.map((c) => {
                  const pctPago = c.prazo_meses ? (c.parcelas_pagas / c.prazo_meses) * 100 : 0;
                  const consultor = c.consultor_id ? profiles.get(c.consultor_id) : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/consorcios/${c.id}`} className="flex items-center gap-3">
                          <Avatar name={c.clientes?.nome} size={34} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold hover:text-brand-600">{c.clientes?.nome ?? "Cliente"}</span>
                            <span className="block text-xs text-muted">{canTransfer && consultor ? consultor.full_name : `Adesão ${date(c.data_adesao)}`}</span>
                          </span>
                        </Link>
                      </td>
                      <td>
                        <Link href={`/consorcios/${c.id}`} className="font-medium hover:text-brand-600">
                          {c.grupo ?? "—"} / {c.cota ?? "—"}
                        </Link>
                        <div className="mt-0.5">
                          <Badge tone="brand">{optionLabel(CATEGORIAS_CONSORCIO, c.categoria)}</Badge>
                        </div>
                      </td>
                      <td className="text-sm">{(c.administradora_id && parceiros.get(c.administradora_id)) || <span className="text-muted">—</span>}</td>
                      <td className="text-right font-semibold tabular-nums">{brl(c.valor_credito)}</td>
                      <td className="text-right tabular-nums">{brl(c.parcela_valor)}</td>
                      <td>
                        <div className="flex items-center justify-between text-xs text-muted">
                          <span>
                            {c.parcelas_pagas}/{c.prazo_meses}
                          </span>
                          <span>{Math.round(pctPago)}%</span>
                        </div>
                        <Progress value={pctPago} className="mt-1 h-1.5" tone={c.status === "contemplada" ? "green" : "brand"} />
                      </td>
                      <td>
                        <StatusBadge options={COTA_STATUS} value={c.status} />
                        {c.contemplada_em && <div className="mt-0.5 text-[11px] text-muted">em {date(c.contemplada_em)}</div>}
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
