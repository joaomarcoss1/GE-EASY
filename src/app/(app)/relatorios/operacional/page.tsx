import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { brl, num, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { PrintButton } from "@/components/ui/print-button";

export const metadata: Metadata = { title: "Relatório operacional" };

type M = Record<string, number>;
type Rel = { total: M; consultores: { consultor_id: string; nome: string; m: M }[] };

const v = (m: M, k: string) => Number(m[k] ?? 0);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
const div = (a: number, b: number) => (b ? brl(a / b) : "—");

/** Colunas de cada relatório (a partir dos indicadores diários, que batem com os dados brutos). */
const VISOES: Record<string, { titulo: string; colunas: [string, (m: M) => string][] }> = {
  checkins: { titulo: "Check-ins", colunas: [
    ["Paradas planejadas", (m) => String(v(m, "paradas"))], ["Visitadas", (m) => String(v(m, "paradas_visitadas"))], ["Cumprimento", (m) => pct(v(m, "paradas_visitadas"), v(m, "paradas"))],
    ["Check-ins", (m) => String(v(m, "checkins"))], ["Fora do raio", (m) => `${v(m, "checkins_fora_raio")} (${pct(v(m, "checkins_fora_raio"), v(m, "checkins"))})`],
    ["Inconsistências de GPS", (m) => String(v(m, "checkins_inconsistentes"))], ["Tempo em visita", (m) => `${Math.round(v(m, "tempo_visita_min") / 60)} h`]] },
  km: { titulo: "Quilometragem e locomoção", colunas: [
    ["Rotas", (m) => String(v(m, "rotas"))], ["Concluídas", (m) => String(v(m, "rotas_concluidas"))], ["Km", (m) => num(v(m, "km"))],
    ["Km por rota", (m) => (v(m, "rotas") ? num(v(m, "km") / v(m, "rotas")) : "—")], ["Locomoção", (m) => `${Math.round(v(m, "tempo_locomocao_min") / 60)} h`],
    ["Locomoção média por parada", (m) => (v(m, "paradas_visitadas") ? `${Math.round(v(m, "tempo_locomocao_min") / v(m, "paradas_visitadas"))} min` : "—")]] },
  gastos: { titulo: "Gastos de campo e custo por cliente", colunas: [
    ["Custo das rotas", (m) => brl(v(m, "custo_rotas"))], ["Despesas lançadas", (m) => brl(v(m, "despesas_rota"))], ["Custo por visitado", (m) => div(v(m, "custo_rotas"), v(m, "paradas_visitadas"))],
    ["Adquiridos em rota", (m) => String(v(m, "adquiridos_rota"))], ["Custo por adquirido (CAC de campo)", (m) => div(v(m, "custo_rotas"), v(m, "adquiridos_rota"))]] },
  clientes: { titulo: "Clientes, leads e vendas", colunas: [
    ["Clientes novos", (m) => String(v(m, "clientes_novos"))], ["Leads", (m) => String(v(m, "leads"))], ["Convertidos", (m) => `${v(m, "leads_convertidos")} (${pct(v(m, "leads_convertidos"), v(m, "leads"))})`],
    ["SLA de lead estourado", (m) => String(v(m, "leads_sla_estourado"))], ["Vendas aprovadas", (m) => String(v(m, "vendas_aprovadas"))], ["Valor", (m) => brl(v(m, "valor_vendas"))], ["Canceladas", (m) => String(v(m, "vendas_canceladas"))]] },
  documentacao: { titulo: "Documentação", colunas: [
    ["Documentos enviados", (m) => String(v(m, "docs_enviados"))], ["Aprovados", (m) => String(v(m, "docs_aprovados"))], ["Recusados", (m) => String(v(m, "docs_recusados"))],
    ["Transferidos (45 dias)", (m) => String(v(m, "transferidos_45"))], ["Encaminhados ao jurídico", (m) => String(v(m, "processos_encaminhados"))]] },
  whatsapp: { titulo: "WhatsApp", colunas: [
    ["Conversas", (m) => String(v(m, "wa_conversas"))], ["Resolvidas", (m) => String(v(m, "wa_resolvidas"))], ["Fora do SLA", (m) => `${v(m, "wa_sla_estourado")} (${pct(v(m, "wa_sla_estourado"), v(m, "wa_conversas"))})`]] },
};

/** Relatórios por período e consultor (check-ins, km, gastos, locomoção, CAC, clientes, documentação, WhatsApp). */
export default async function OperacionalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  if (!can(profile, "relatorios.view")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const hoje = todayISO();
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.fim ?? "") ? sp.fim! : hoje;
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(sp.inicio ?? "") ? sp.inicio! : `${hoje.slice(0, 7)}-01`;
  const visao = VISOES[sp.tab ?? ""] ? sp.tab! : "checkins";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("relatorio_operacional", { p_inicio: inicio, p_fim: fim });
  const r = data as Rel | null;
  const cfg = VISOES[visao];
  const q = `&inicio=${inicio}&fim=${fim}`;
  return (
    <>
      <PageHeader eyebrow="Relatórios" title="Relatório operacional" description="Indicadores consolidados por dia; o dia de hoje é calculado na hora." actions={<PrintButton />} />
      <form className="mb-4 flex flex-wrap items-end gap-3 text-sm print:hidden">
        <input type="hidden" name="tab" value={visao} />
        <label className="grid gap-1">De<input className="input" type="date" name="inicio" defaultValue={inicio} /></label>
        <label className="grid gap-1">Até<input className="input" type="date" name="fim" defaultValue={fim} /></label>
        <button className="rounded-xl border border-line px-4 py-2 font-semibold">Filtrar</button>
      </form>
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line print:hidden">
        {Object.entries(VISOES).map(([k, x]) => (
          <Link key={k} href={`/relatorios/operacional?tab=${k}${q}`} scroll={false} className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${k === visao ? "border-accent-500 text-fg" : "border-transparent text-muted hover:text-fg"}`}>{x.titulo}</Link>
        ))}
      </nav>
      {error || !r ? <EmptyState title="Relatório indisponível" description={error?.message} /> : (
        <Card>
          <CardHeader title={cfg.titulo} />
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Consultor</th>{cfg.colunas.map(([t]) => <th key={t} className="text-right">{t}</th>)}</tr></thead>
            <tbody>
              {r.consultores.map((c) => <tr key={c.consultor_id}><td className="font-medium">{c.nome}</td>{cfg.colunas.map(([t, f]) => <td key={t} className="text-right text-sm">{f(c.m)}</td>)}</tr>)}
              <tr className="bg-surface-2 font-semibold"><td>Total da empresa</td>{cfg.colunas.map(([t, f]) => <td key={t} className="text-right text-sm">{f(r.total)}</td>)}</tr>
            </tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}
