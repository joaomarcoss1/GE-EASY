import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, BarChart3, Landmark, PieChart, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { brl, date, monthLabel, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PrintButton } from "@/components/ui/print-button";

export const metadata: Metadata = { title: "Relatórios financeiros" };

type Rel = {
  fluxo: { mes: string; receita_prevista: number; receita_realizada: number; despesa_prevista: number; despesa_realizada: number }[];
  dre: { receitas: { categoria: string; valor: number }[]; despesas: { categoria: string; valor: number }[]; total_receitas: number; total_despesas: number };
  centros: { centro: string; despesas: number | null; receitas: number | null }[];
  inadimplencia: { ate_30: number; de_31_60: number; de_61_90: number; acima_90: number; devedores: { id: string; nome: string; valor: number; desde: string }[] };
  saldos: { nome: string; saldo: number }[];
};

/** Fluxo de caixa (previsto × realizado), DRE gerencial por competência, centros de custo, inadimplência e saldos. */
export default async function RelatoriosFinanceirosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  if (!can(profile, "financeiro.view") && !can(profile, "relatorios.view")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const hoje = todayISO();
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.fim ?? "") ? sp.fim! : new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(sp.inicio ?? "") ? sp.inicio! : `${Number(hoje.slice(0, 4))}-01-01`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("relatorio_financeiro", { p_inicio: inicio, p_fim: fim });
  if (error || !data) return <EmptyState title="Relatório indisponível" />;
  const r = data as Rel;
  const resultado = Number(r.dre.total_receitas) - Number(r.dre.total_despesas);
  const inad = r.inadimplencia;
  const totalInad = Number(inad.ate_30) + Number(inad.de_31_60) + Number(inad.de_61_90) + Number(inad.acima_90);
  const maxFluxo = Math.max(1, ...r.fluxo.flatMap((f) => [f.receita_prevista, f.receita_realizada, f.despesa_prevista, f.despesa_realizada].map(Number)));
  const barra = (v: number, cor: string) => <div className={`h-2 rounded ${cor}`} style={{ width: `${Math.max(1, (Number(v) / maxFluxo) * 100)}%` }} />;

  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Relatórios financeiros" description={`Período de ${date(inicio)} a ${date(fim)} (competência pelo vencimento; realizado pela data do pagamento).`} actions={<PrintButton />} />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm print:hidden">
        <label className="grid gap-1">De<input className="input" type="date" name="inicio" defaultValue={inicio} /></label>
        <label className="grid gap-1">Até<input className="input" type="date" name="fim" defaultValue={fim} /></label>
        <button className="rounded-xl border border-line px-4 py-2 font-semibold">Filtrar</button>
      </form>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Receitas (competência)" value={brl(r.dre.total_receitas)} icon={<TrendingUp className="h-5 w-5" />} tone="green" />
        <StatCard label="Despesas (competência)" value={brl(r.dre.total_despesas)} icon={<BarChart3 className="h-5 w-5" />} tone="amber" />
        <StatCard label="Resultado" value={brl(resultado)} icon={<PieChart className="h-5 w-5" />} tone={resultado >= 0 ? "brand" : "accent"} hint={Number(r.dre.total_receitas) ? `Margem ${((resultado / Number(r.dre.total_receitas)) * 100).toFixed(1)}%` : undefined} />
        <StatCard label="Inadimplência" value={brl(totalInad)} icon={<AlertTriangle className="h-5 w-5" />} tone="accent" hint={`${brl(inad.acima_90)} há mais de 90 dias`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Fluxo de caixa: previsto × realizado" icon={<TrendingUp className="h-4 w-4" />} />
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th className="text-right">Saldo realizado</th></tr></thead>
            <tbody>{r.fluxo.map((f) => (
              <tr key={f.mes}>
                <td className="whitespace-nowrap text-sm">{monthLabel(f.mes)}</td>
                <td className="min-w-40 text-xs"><div className="space-y-1">{barra(f.receita_prevista, "bg-emerald-200")}{barra(f.receita_realizada, "bg-emerald-600")}</div><span className="text-muted">{brl(f.receita_realizada)} de {brl(f.receita_prevista)}</span></td>
                <td className="min-w-40 text-xs"><div className="space-y-1">{barra(f.despesa_prevista, "bg-red-200")}{barra(f.despesa_realizada, "bg-red-600")}</div><span className="text-muted">{brl(f.despesa_realizada)} de {brl(f.despesa_prevista)}</span></td>
                <td className={`text-right text-sm font-semibold ${Number(f.receita_realizada) - Number(f.despesa_realizada) < 0 ? "text-red-600" : ""}`}>{brl(Number(f.receita_realizada) - Number(f.despesa_realizada))}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="px-5 py-2 text-[11px] text-muted">Barra clara = previsto · barra escura = realizado</p>
        </Card>
        <Card>
          <CardHeader title="DRE gerencial" icon={<BarChart3 className="h-4 w-4" />} />
          <table className="table-base">
            <tbody>
              <tr className="bg-surface-2"><td className="font-semibold">Receitas</td><td className="text-right font-semibold">{brl(r.dre.total_receitas)}</td></tr>
              {r.dre.receitas.map((x) => <tr key={`r${x.categoria}`}><td className="pl-8 text-sm">{x.categoria}</td><td className="text-right text-sm">{brl(x.valor)}</td></tr>)}
              <tr className="bg-surface-2"><td className="font-semibold">(−) Despesas</td><td className="text-right font-semibold">{brl(r.dre.total_despesas)}</td></tr>
              {r.dre.despesas.map((x) => <tr key={`d${x.categoria}`}><td className="pl-8 text-sm">{x.categoria}</td><td className="text-right text-sm">{brl(x.valor)}</td></tr>)}
              <tr><td className="font-bold">(=) Resultado</td><td className={`text-right font-bold ${resultado < 0 ? "text-red-600" : "text-emerald-700"}`}>{brl(resultado)}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Por centro de custo" icon={<PieChart className="h-4 w-4" />} />
          {!r.centros.length ? <EmptyState title="Sem lançamentos" /> : (
            <table className="table-base"><thead><tr><th>Centro</th><th className="text-right">Despesas</th><th className="text-right">Receitas</th></tr></thead>
              <tbody>{r.centros.map((c) => <tr key={c.centro}><td className="text-sm">{c.centro}</td><td className="text-right text-sm">{brl(c.despesas ?? 0)}</td><td className="text-right text-sm">{brl(c.receitas ?? 0)}</td></tr>)}</tbody></table>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Inadimplência por atraso" icon={<AlertTriangle className="h-4 w-4" />} />
            <div className="grid grid-cols-4 gap-2 p-4 text-center text-sm">
              {[["até 30 dias", inad.ate_30], ["31–60", inad.de_31_60], ["61–90", inad.de_61_90], ["+90", inad.acima_90]].map(([l, v]) => <div key={l as string}><p className="text-xs text-muted">{l as string}</p><p className="font-semibold">{brl(v as number)}</p></div>)}
            </div>
            {inad.devedores.length > 0 && <ul className="divide-y divide-line border-t border-line text-sm">{inad.devedores.map((d) => (
              <li key={d.id} className="flex justify-between px-5 py-2"><Link href={`/clientes/${d.id}`} className="hover:text-brand-600">{d.nome}</Link><span>{brl(d.valor)} <span className="text-xs text-muted">desde {date(d.desde)}</span></span></li>
            ))}</ul>}
          </Card>
          <Card>
            <CardHeader title="Saldos das contas" icon={<Landmark className="h-4 w-4" />} />
            {!r.saldos.length ? <EmptyState title="Nenhuma conta bancária" /> : <ul className="divide-y divide-line text-sm">{r.saldos.map((s) => <li key={s.nome} className="flex justify-between px-5 py-2.5"><span>{s.nome}</span><span className={`font-semibold ${Number(s.saldo) < 0 ? "text-red-600" : ""}`}>{brl(s.saldo)}</span></li>)}</ul>}
          </Card>
        </div>
      </div>
    </>
  );
}
