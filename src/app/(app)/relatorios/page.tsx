import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AlertOctagon, ArrowDownToLine, Building2, Filter, PieChart, ShieldCheck, Users, Landmark, TrendingUp } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap, parceiroMap } from "@/lib/data";
import { CLIENTE_STATUS, LINHAS, type Option } from "@/lib/constants";
import { brl, brlShort, date, num, pct } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { DonutChart, HBarChart } from "@/components/dashboard/charts";
import { PrintButton } from "@/components/relatorios/print-button";
import { PeriodFilter } from "@/components/relatorios/period-filter";
import { SegmentTabs } from "@/components/ui/filters";
import { RelatorioJuridico } from "@/components/juridico/relatorio-juridico";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, firstDay, monthShort, rangeParam, spStartOf, sum } from "@/components/dashboard/periods";

export const metadata: Metadata = { title: "Relatórios" };

type Num = number | string;
type ClienteRef = { nome: string } | { nome: string }[] | null;
const nomeCliente = (c: ClienteRef) => (Array.isArray(c) ? c[0]?.nome : c?.nome) ?? "—";

interface CotaRow { valor_credito: Num; consultor_id: string | null; administradora_id: string | null }
interface ApoliceRow { premio_liquido: Num; consultor_id: string | null; seguradora_id: string | null }
interface ComissaoRow { valor_corretora: Num; valor_consultor: Num; consultor_id: string | null }
interface ClienteRow { status: string; origem: string | null; created_at: string }
interface OportRow { etapa: string; valor: Num; motivo_perda: string | null; linha: string }
interface InadRow { id: string; grupo: string | null; cota: string | null; valor_credito: Num; parcela_valor: Num; administradora_id: string | null; consultor_id: string | null; cliente_id: string; clientes: ClienteRef }
interface CancelRow { valor_credito: Num; administradora_id: string | null }

function ShareBar({ value, max, tone = "brand" }: { value: number; max: number; tone?: "brand" | "accent" }) {
  const w = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full min-w-[80px] overflow-hidden rounded-full bg-surface-2">
      <div className={tone === "brand" ? "h-full rounded-full bg-brand-500 dark:bg-brand-400" : "h-full rounded-full bg-accent-500"} style={{ width: `${w}%` }} />
    </div>
  );
}

function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-10 flex items-center gap-2 text-lg font-bold tracking-tight print:mt-6 print:break-after-avoid">
      <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-700 text-xs font-bold text-white">{n}</span>
      {children}
    </h2>
  );
}

const SECOES: Option[] = [
  { value: "juridico", label: "Jurídico" },
  { value: "comercial", label: "Comercial" },
];

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("relatorios.view");
  const sp = await searchParams;
  const secao = sp.secao === "comercial" ? "comercial" : "juridico";
  const { de, ate } = rangeParam(sp.de, sp.ate);

  const q = `de=${de}&ate=${ate}`;
  const exports =
    secao === "juridico"
      ? [
          { href: `/api/exportar/processos`, label: "Processos (carteira completa)" },
          { href: `/api/exportar/prazos?${q}`, label: "Prazos do período" },
        ]
      : [
          { href: `/api/exportar/clientes?${q}`, label: "Clientes" },
          { href: `/api/exportar/cotas?${q}`, label: "Cotas" },
          { href: `/api/exportar/apolices?${q}`, label: "Apólices" },
          { href: `/api/exportar/oportunidades?${q}`, label: "Oportunidades" },
          { href: `/api/exportar/comissoes?${q}`, label: "Comissões" },
        ];

  return (
    <>
      <PageHeader
        eyebrow="Gestão"
        title="Relatórios gerenciais"
        description={`${secao === "juridico" ? "Jurídico" : "Comercial"} · período: ${date(de)} a ${date(ate)}`}
        actions={
          <>
            <LinkButton href="/relatorios/mensal" variant="accent">Relatório mensal</LinkButton>
            <LinkButton href="/relatorios/operacional" variant="secondary">Operacional (campo, leads, WhatsApp)</LinkButton>
            <PrintButton />
          </>
        }
      />

      <div className="no-print mb-4">
        <Suspense fallback={null}>
          <SegmentTabs param="secao" options={SECOES} />
        </Suspense>
      </div>

      <Card className="no-print mb-6">
        <div className="space-y-4 p-4">
          <PeriodFilter de={de} ate={ate} extra={secao === "comercial" ? { secao } : undefined} />
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-muted">Exportar CSV</span>
            {exports.map((e) => (
              <LinkButton key={e.label} href={e.href} variant="secondary" size="sm" prefetch={false}>
                <ArrowDownToLine className="h-3.5 w-3.5" /> {e.label}
              </LinkButton>
            ))}
          </div>
        </div>
      </Card>

      <div className="hidden print:mb-4 print:block">
        <p className="text-xs text-muted">
          GE EASY · Relatório {secao === "juridico" ? "jurídico" : "comercial"} · {date(de)} a {date(ate)} · gerado em {date(new Date().toISOString())}
        </p>
      </div>

      {secao === "juridico" ? <RelatorioJuridico de={de} ate={ate} /> : <RelatorioComercial de={de} ate={ate} />}
    </>
  );
}

/** Seção comercial (consórcios e seguros) — conteúdo original dos relatórios. */
async function RelatorioComercial({ de, ate }: { de: string; ate: string }) {
  const deTs = spStartOf(de);
  const ateTs = spStartOf(addDays(ate, 1));
  const supabase = await createClient();

  const [cotas, apolices, comissoes, clientes, fechadas, criadasRes, inadRes, canceladas, baseAtivaRes, profiles, parceiros] = await Promise.all([
    fetchAll<CotaRow>((f, t) =>
      supabase.from("consorcio_cotas").select("valor_credito, consultor_id, administradora_id").gte("data_adesao", de).lte("data_adesao", ate).not("status", "in", "(proposta,cancelada)").order("id").range(f, t),
    ),
    fetchAll<ApoliceRow>((f, t) =>
      supabase.from("seguro_apolices").select("premio_liquido, consultor_id, seguradora_id").gte("inicio_vigencia", de).lte("inicio_vigencia", ate).in("status", ["vigente", "renovada"]).order("id").range(f, t),
    ),
    fetchAll<ComissaoRow>((f, t) =>
      supabase.from("comissoes").select("valor_corretora, valor_consultor, consultor_id").gte("competencia", firstDay(de.slice(0, 7))).lte("competencia", firstDay(ate.slice(0, 7))).neq("status", "estornada").order("id").range(f, t),
    ),
    fetchAll<ClienteRow>((f, t) => supabase.from("clientes").select("status, origem, created_at").order("id").range(f, t), 20_000),
    fetchAll<OportRow>((f, t) => supabase.from("oportunidades").select("etapa, valor, motivo_perda, linha").in("etapa", ["ganho", "perdido"]).gte("fechado_em", deTs).lt("fechado_em", ateTs).order("id").range(f, t)),
    supabase.from("oportunidades").select("id", { count: "exact", head: true }).gte("created_at", deTs).lt("created_at", ateTs),
    supabase
      .from("consorcio_cotas")
      .select("id, grupo, cota, valor_credito, parcela_valor, administradora_id, consultor_id, cliente_id, clientes(nome)", { count: "exact" })
      .eq("status", "inadimplente")
      .order("valor_credito", { ascending: false })
      .limit(25),
    fetchAll<CancelRow>((f, t) => supabase.from("consorcio_cotas").select("valor_credito, administradora_id").eq("status", "cancelada").gte("cancelada_em", de).lte("cancelada_em", ate).order("id").range(f, t)),
    supabase.from("consorcio_cotas").select("id", { count: "exact", head: true }).in("status", ["ativa", "contemplada", "inadimplente"]),
    getProfileMap(),
    parceiroMap(),
  ]);

  const nomeConsultor = (id: string | null) => (id ? (profiles.get(id)?.full_name ?? "—") : "Sem consultor");
  const nomeParceiro = (id: string | null) => (id ? (parceiros.get(id) ?? "—") : "Não informada");

  // ---------------------------------------------------------------- 1. Produção por consultor
  const consultorIds = new Set<string | null>([...cotas.map((c) => c.consultor_id), ...apolices.map((a) => a.consultor_id), ...comissoes.map((c) => c.consultor_id)]);
  const porConsultor = [...consultorIds]
    .map((id) => {
      const c = cotas.filter((r) => r.consultor_id === id);
      const a = apolices.filter((r) => r.consultor_id === id);
      const m = comissoes.filter((r) => r.consultor_id === id);
      return { id, nome: nomeConsultor(id), cotas: c.length, credito: sum(c, (r) => r.valor_credito), apolices: a.length, premio: sum(a, (r) => r.premio_liquido), comissao: sum(m, (r) => r.valor_corretora), repasse: sum(m, (r) => r.valor_consultor) };
    })
    .sort((x, y) => y.comissao - x.comissao || y.credito + y.premio - (x.credito + x.premio));
  const totCredito = sum(cotas, (r) => r.valor_credito);
  const totPremio = sum(apolices, (r) => r.premio_liquido);
  const totComissao = sum(comissoes, (r) => r.valor_corretora);
  const totRepasse = sum(comissoes, (r) => r.valor_consultor);

  // ---------------------------------------------------------------- 2. Parceiros
  const groupBy = <T,>(rows: T[], key: (r: T) => string | null, val: (r: T) => Num) => {
    const m = new Map<string | null, { qtd: number; total: number }>();
    rows.forEach((r) => {
      const k = key(r);
      const cur = m.get(k) ?? { qtd: 0, total: 0 };
      cur.qtd += 1;
      cur.total += Number(val(r));
      m.set(k, cur);
    });
    return [...m.entries()].map(([k, v]) => ({ id: k, ...v })).sort((a, b) => b.total - a.total);
  };
  const porAdministradora = groupBy(cotas, (r) => r.administradora_id, (r) => r.valor_credito);
  const porSeguradora = groupBy(apolices, (r) => r.seguradora_id, (r) => r.premio_liquido);

  // ---------------------------------------------------------------- 3. Carteira
  const [t0, t1] = [new Date(deTs).getTime(), new Date(ateTs).getTime()];
  const novosPeriodo = clientes.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return t >= t0 && t < t1;
  }).length;
  const porStatus = CLIENTE_STATUS.map((s) => ({ label: s.label, value: clientes.filter((c) => c.status === s.value).length, display: num(clientes.filter((c) => c.status === s.value).length) }));
  const origemMap = new Map<string, number>();
  clientes.forEach((c) => origemMap.set(c.origem || "Não informada", (origemMap.get(c.origem || "Não informada") ?? 0) + 1));
  const porOrigem = [...origemMap.entries()].map(([label, value]) => ({ label, value, display: num(value) }));

  // ---------------------------------------------------------------- 4. Funil
  const ganhas = fechadas.filter((o) => o.etapa === "ganho");
  const perdidas = fechadas.filter((o) => o.etapa === "perdido");
  const taxa = fechadas.length ? (ganhas.length / fechadas.length) * 100 : null;
  const motivosMap = new Map<string, { qtd: number; valor: number }>();
  perdidas.forEach((o) => {
    const k = (o.motivo_perda ?? "").trim() || "Não informado";
    const cur = motivosMap.get(k) ?? { qtd: 0, valor: 0 };
    cur.qtd += 1;
    cur.valor += Number(o.valor);
    motivosMap.set(k, cur);
  });
  const motivos = [...motivosMap.entries()].sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 8);
  const conversaoLinha = LINHAS.map((l) => {
    const g = ganhas.filter((o) => o.linha === l.value).length;
    const p = perdidas.filter((o) => o.linha === l.value).length;
    return { label: l.label, g, p, taxa: g + p ? (g / (g + p)) * 100 : null };
  });

  // ---------------------------------------------------------------- 5. Inadimplência
  const inad = (inadRes.data ?? []) as InadRow[];
  const inadCount = inadRes.count ?? inad.length;
  const baseAtiva = baseAtivaRes.count ?? 0;
  const taxaInad = baseAtiva ? (inadCount / baseAtiva) * 100 : 0;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <StatCard label="Crédito vendido" value={brl(totCredito)} icon={<Landmark className="h-5 w-5" />} hint={`${num(cotas.length)} cota(s)`} />
        <StatCard label="Prêmio emitido" value={brl(totPremio)} icon={<ShieldCheck className="h-5 w-5" />} tone="accent" hint={`${num(apolices.length)} apólice(s)`} />
        <StatCard label="Comissão gerada" value={brl(totComissao)} icon={<TrendingUp className="h-5 w-5" />} tone="green" hint={`repasse ${brlShort(totRepasse)} · margem ${brlShort(totComissao - totRepasse)}`} />
        <StatCard label="Conversão do funil" value={taxa === null ? "—" : pct(taxa)} icon={<Filter className="h-5 w-5" />} tone="amber" hint={`${num(ganhas.length)} ganha(s) · ${num(perdidas.length)} perdida(s)`} />
      </div>

      {/* 1 ---------------------------------------------------------------- */}
      <SectionTitle n={1}>Produção por consultor</SectionTitle>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2 print:break-inside-avoid">
          {porConsultor.length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title="Sem produção no período" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Consultor</th>
                    <th className="text-right">Cotas</th>
                    <th className="text-right">Crédito</th>
                    <th className="text-right">Apólices</th>
                    <th className="text-right">Prêmio</th>
                    <th className="text-right">Comissão</th>
                    <th className="text-right">Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  {porConsultor.map((r) => (
                    <tr key={r.id ?? "none"}>
                      <td className="font-medium">{r.nome}</td>
                      <td className="text-right tabular-nums">{num(r.cotas)}</td>
                      <td className="text-right tabular-nums">{brl(r.credito)}</td>
                      <td className="text-right tabular-nums">{num(r.apolices)}</td>
                      <td className="text-right tabular-nums">{brl(r.premio)}</td>
                      <td className="text-right font-semibold tabular-nums">{brl(r.comissao)}</td>
                      <td className="text-right tabular-nums text-muted">{brl(r.repasse)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(cotas.length)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(totCredito)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(apolices.length)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(totPremio)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(totComissao)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{brl(totRepasse)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>
        <Card className="print:break-inside-avoid">
          <CardHeader title="Comissão gerada por consultor" description="Top 8 do período" />
          <CardBody>
            <HBarChart
              data={porConsultor.slice(0, 8).map((r) => ({ label: r.nome.split(" ").slice(0, 2).join(" "), value: r.comissao, display: brlShort(r.comissao), detail: "Comissão" }))}
              labelWidth={110}
              emptyText="Sem comissões no período."
            />
          </CardBody>
        </Card>
      </div>

      {/* 2 ---------------------------------------------------------------- */}
      <SectionTitle n={2}>Produção por administradora e seguradora</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        {(
          [
            { title: "Administradoras de consórcio", icon: <Landmark className="h-4 w-4" />, rows: porAdministradora, unit: "cota(s)", tone: "brand" as const, total: totCredito },
            { title: "Seguradoras", icon: <Building2 className="h-4 w-4" />, rows: porSeguradora, unit: "apólice(s)", tone: "accent" as const, total: totPremio },
          ]
        ).map((blk) => (
          <Card key={blk.title} className="print:break-inside-avoid">
            <CardHeader icon={blk.icon} title={blk.title} description={`Total ${brl(blk.total)}`} />
            {blk.rows.length === 0 ? (
              <EmptyState title="Sem produção no período" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Parceira</th>
                      <th className="text-right">Qtd.</th>
                      <th className="text-right">{blk.tone === "brand" ? "Crédito" : "Prêmio"}</th>
                      <th className="w-40">Participação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blk.rows.map((r) => (
                      <tr key={r.id ?? "none"}>
                        <td className="font-medium">{nomeParceiro(r.id)}</td>
                        <td className="text-right tabular-nums">{num(r.qtd)}</td>
                        <td className="text-right font-semibold tabular-nums">{brl(r.total)}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ShareBar value={r.total} max={blk.rows[0].total} tone={blk.tone} />
                            <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(blk.total ? (r.total / blk.total) * 100 : 0, 0)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* 3 ---------------------------------------------------------------- */}
      <SectionTitle n={3}>Carteira de clientes</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="print:break-inside-avoid">
          <CardHeader icon={<PieChart className="h-4 w-4" />} title="Por status" description={`${num(clientes.length)} cliente(s) na carteira · ${num(novosPeriodo)} novo(s) no período`} />
          <CardBody>
            <DonutChart data={porStatus} centerLabel="Clientes" centerValue={num(clientes.length)} money={false} />
          </CardBody>
        </Card>
        <Card className="print:break-inside-avoid">
          <CardHeader icon={<Users className="h-4 w-4" />} title="Por origem do contato" description="Canais que mais trazem clientes" />
          <CardBody>
            <DonutChart data={porOrigem} centerLabel="Origens" centerValue={num(porOrigem.length)} money={false} />
          </CardBody>
        </Card>
      </div>

      {/* 4 ---------------------------------------------------------------- */}
      <SectionTitle n={4}>Conversão do funil</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="print:break-inside-avoid">
          <CardHeader icon={<Filter className="h-4 w-4" />} title="Resultado das oportunidades" description={`${num(criadasRes.count ?? 0)} criada(s) no período`} />
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line p-3">
                <p className="text-xs text-muted">Ganhas</p>
                <p className="text-xl font-bold">{num(ganhas.length)}</p>
                <p className="text-xs text-muted">{brlShort(sum(ganhas, (o) => o.valor))}</p>
              </div>
              <div className="rounded-xl border border-line p-3">
                <p className="text-xs text-muted">Perdidas</p>
                <p className="text-xl font-bold">{num(perdidas.length)}</p>
                <p className="text-xs text-muted">{brlShort(sum(perdidas, (o) => o.valor))}</p>
              </div>
            </div>
            <div className="space-y-3">
              {conversaoLinha.map((l) => (
                <div key={l.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{l.label}</span>
                    <span className="text-xs text-muted">
                      {num(l.g)} de {num(l.g + l.p)} · <strong className="text-fg">{l.taxa === null ? "—" : pct(l.taxa, 0)}</strong>
                    </span>
                  </div>
                  <ShareBar value={l.taxa ?? 0} max={100} tone={l.label === "Seguro" ? "accent" : "brand"} />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2 print:break-inside-avoid">
          <CardHeader icon={<AlertOctagon className="h-4 w-4" />} title="Motivos de perda" description="Oportunidades perdidas no período" />
          <CardBody>
            <HBarChart
              data={motivos.map(([label, v]) => ({ label: label.length > 22 ? label.slice(0, 21) + "…" : label, value: v.qtd, display: `${num(v.qtd)} · ${brlShort(v.valor)}`, detail: label }))}
              colorIndex={1}
              labelWidth={150}
              emptyText="Nenhuma oportunidade perdida no período."
            />
          </CardBody>
        </Card>
      </div>

      {/* 5 ---------------------------------------------------------------- */}
      <SectionTitle n={5}>Inadimplência e cancelamentos de cotas</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Cotas inadimplentes (hoje)" value={num(inadCount)} icon={<AlertOctagon className="h-5 w-5" />} tone="amber" hint={`${pct(taxaInad)} da base ativa (${num(baseAtiva)})`} />
        <StatCard label="Cancelamentos no período" value={num(canceladas.length)} icon={<AlertOctagon className="h-5 w-5" />} tone="accent" hint={`${brl(sum(canceladas, (c) => c.valor_credito))} em crédito`} />
        <StatCard
          label="Crédito inadimplente (top 25)"
          value={brl(sum(inad, (c) => c.valor_credito))}
          icon={<Landmark className="h-5 w-5" />}
          hint={inadCount > inad.length ? `exibindo ${inad.length} de ${inadCount}` : "todas listadas abaixo"}
        />
      </div>
      <Card className="mt-6 print:break-inside-avoid">
        <CardHeader title="Cotas inadimplentes" description="Maiores créditos primeiro" />
        {inad.length === 0 ? (
          <EmptyState title="Nenhuma cota inadimplente" description="Ótimo! Não há cotas em atraso no momento." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Administradora</th>
                  <th>Grupo / cota</th>
                  <th className="text-right">Crédito</th>
                  <th className="text-right">Parcela</th>
                  <th>Consultor</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {inad.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/clientes/${c.cliente_id}`} className="font-medium hover:text-brand-600">
                        {nomeCliente(c.clientes)}
                      </Link>
                    </td>
                    <td className="text-sm">{nomeParceiro(c.administradora_id)}</td>
                    <td className="text-sm tabular-nums">
                      {c.grupo ?? "—"} / {c.cota ?? "—"}
                    </td>
                    <td className="text-right font-semibold tabular-nums">{brl(c.valor_credito)}</td>
                    <td className="text-right tabular-nums">{brl(c.parcela_valor)}</td>
                    <td className="text-sm">{nomeConsultor(c.consultor_id)}</td>
                    <td>
                      <Badge tone="amber" dot>
                        Inadimplente
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-6 text-xs text-muted">
        Notas: produção considera cotas fora de proposta/cancelamento pela data de adesão e apólices vigentes/renovadas pelo início de vigência; comissões pela competência
        (de {monthShort(de.slice(0, 7))} a {monthShort(ate.slice(0, 7))}), sem estornos. Cancelamentos usam a data da última alteração da cota.
      </p>
    </>
  );
}
