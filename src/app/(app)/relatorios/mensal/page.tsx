import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, CalendarRange, FileBarChart, Settings, Trophy } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { SITUACOES_ENCAMINHAMENTO, SITUACOES_VENDA, toMap } from "@/lib/constants";
import { brl, dateTime, num } from "@/lib/format";
import { gerarRelatorioMensal, salvarParametrosRelatorios } from "@/lib/actions/relatorios";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { LinkButton } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";

export const metadata: Metadata = { title: "Relatório mensal" };

type M = Record<string, number>;
type Dados = {
  competencia: string; indicadores: M; anterior: M;
  gastos: { rotas: number; despesas_rota: M; financeiro: M; financeiro_total: number; financeiro_total_anterior: number };
  clientes: { por_origem: M; por_cidade: { cidade: string; n: number }[]; custo_por_cliente: number | null };
  documentacao: { pendentes_hoje: number; completas_no_mes: number; transferidos_45: number };
  vendas: { por_situacao: M; lista: { situacao: string; cliente: string; titulo: string; valor: number; consultor: string }[] };
  processos: { por_situacao: M; lista: { situacao: string; titulo: string; cliente: string }[] };
  whatsapp: { conversas: number; sla_estourado: number; resolvidas: number; leads: number; leads_convertidos: number };
  ranking: { consultor_id: string; nome: string; m: M; pontos: number; custo_por_cliente: number | null }[];
  pesos: M; atencao: { tipo: string; texto: string }[];
};
const vendas = toMap(SITUACOES_VENDA);
const encaminh = toMap(SITUACOES_ENCAMINHAMENTO);
const PESOS: [string, string][] = [["clientes_novos", "Clientes novos"], ["vendas_aprovadas", "Vendas aprovadas"], ["paradas_visitadas", "Visitas realizadas"], ["leads_convertidos", "Leads convertidos"], ["checkins_fora_raio", "Check-ins fora do raio"], ["transferidos_45", "Transferidos (45 dias)"]];

/** Variação percentual com seta, para comparar com o mês anterior. */
function Var({ atual, anterior, inverso }: { atual: number; anterior: number; inverso?: boolean }) {
  if (!anterior) return null;
  const p = ((atual - anterior) / anterior) * 100;
  const bom = inverso ? p <= 0 : p >= 0;
  return <span className={`ml-1 text-xs ${bom ? "text-emerald-700" : "text-red-600"}`}>{p >= 0 ? "▲" : "▼"} {Math.abs(p).toFixed(0)}%</span>;
}

/** Fechamento mensal geral: gerado sozinho no 1º dia útil do mês seguinte (ou sob demanda), pronto para imprimir/PDF. */
export default async function RelatorioMensalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  if (!can(profile, "relatorios.view")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: lista }, { data: cfg }] = await Promise.all([
    supabase.from("relatorios_mensais").select("id, competencia, gerado_em, automatico").order("competencia", { ascending: false }).limit(24),
    supabase.from("configuracoes").select("valor").eq("chave", "relatorios").maybeSingle(),
  ]);
  const sel = lista?.find((l) => l.id === sp.c) ?? lista?.[0];
  const { data: rel } = sel ? await supabase.from("relatorios_mensais").select("dados, gerado_em").eq("id", sel.id).maybeSingle() : { data: null };
  const d = rel?.dados as Dados | undefined;
  const p = (cfg?.valor ?? {}) as { pesos?: M; limite_fora_raio_pct?: number; fator_custo_cliente?: number; destinatarios?: string[] };
  const anterior = new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 7);
  const i = d?.indicadores ?? {};
  const a = d?.anterior ?? {};
  const n = (k: string, o: M = i) => Number(o[k] ?? 0);

  return (
    <>
      <PageHeader eyebrow="Relatórios" title={d ? `Fechamento de ${d.competencia.slice(5, 7)}/${d.competencia.slice(0, 4)}` : "Relatório mensal"}
        description={rel ? `Gerado em ${dateTime(rel.gerado_em)}${sel?.automatico ? " (automático)" : ""}. Comparação com o mês anterior.` : "Gerado automaticamente no 1º dia útil de cada mês."}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <PrintButton />
            <FormDrawerButton action={gerarRelatorioMensal} title="Gerar relatório" label="Gerar / atualizar" variant="secondary" values={{ competencia: anterior }} submitLabel="Gerar" redirectTo="/relatorios/mensal?c=:id"
              fields={[{ name: "competencia", label: "Mês (AAAA-MM)", required: true, span: 6 }]} />
            <FormDrawerButton action={salvarParametrosRelatorios} title="Parâmetros do relatório" label="Parâmetros" icon="none" variant="ghost" width="max-w-xl"
              values={{ ...Object.fromEntries(PESOS.map(([k]) => [k, p.pesos?.[k] ?? { clientes_novos: 3, vendas_aprovadas: 5, paradas_visitadas: 1, leads_convertidos: 2, checkins_fora_raio: -1, transferidos_45: -2 }[k]])),
                limite_fora_raio_pct: p.limite_fora_raio_pct ?? 20, fator_custo_cliente: p.fator_custo_cliente ?? 2, destinatarios: (p.destinatarios ?? []).join(", ") }}
              fields={[
                ...PESOS.map(([k, l]) => ({ name: k, label: `Peso: ${l}`, type: "number" as const, min: -100, max: 100, span: 2 as const, section: k === "clientes_novos" ? "Ranking de consultores" : undefined })),
                { name: "limite_fora_raio_pct", label: "Alerta: check-ins fora do raio acima de (%)", type: "number", min: 1, max: 100, span: 3, section: "Pontos de atenção" },
                { name: "fator_custo_cliente", label: "Alerta: custo por cliente acima de (× média)", type: "number", min: 1, max: 10, span: 3 },
                { name: "destinatarios", label: "Enviar por e-mail para", type: "textarea", rows: 2, span: 6, help: "Separe por vírgula. Vazio = administradores master. Requer RESEND_API_KEY no servidor.", section: "Envio" },
              ]} />
          </div>
        } />
      {(lista?.length ?? 0) > 1 && (
        <div className="mb-4 flex flex-wrap gap-2 print:hidden">
          {lista!.map((l) => <LinkButton key={l.id} href={`/relatorios/mensal?c=${l.id}`} size="sm" variant={l.id === sel?.id ? "primary" : "secondary"}>{String(l.competencia).slice(5, 7)}/{String(l.competencia).slice(0, 4)}</LinkButton>)}
        </div>
      )}
      {!d ? <Card><EmptyState icon={<FileBarChart className="h-6 w-6" />} title="Nenhum relatório ainda" description="Gere o do mês passado agora ou aguarde o 1º dia útil." /></Card> : (
        <div className="space-y-6">
          {d.atencao.length > 0 && (
            <Card>
              <CardHeader title="Pontos de atenção" icon={<AlertTriangle className="h-4 w-4" />} />
              <ul className="list-disc space-y-1 px-10 py-4 text-sm">{d.atencao.map((x, k) => <li key={k}>{x.texto}</li>)}</ul>
            </Card>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Clientes novos" value={<>{n("clientes_novos")}<Var atual={n("clientes_novos")} anterior={n("clientes_novos", a)} /></>} hint={d.clientes.custo_por_cliente != null ? `Custo de campo por cliente: ${brl(d.clientes.custo_por_cliente)}` : undefined} />
            <StatCard label="Vendas aprovadas" value={<>{n("vendas_aprovadas")}<Var atual={n("vendas_aprovadas")} anterior={n("vendas_aprovadas", a)} /></>} tone="green" hint={brl(n("valor_vendas"))} />
            <StatCard label="Gastos totais" value={<>{brl(d.gastos.financeiro_total)}<Var atual={d.gastos.financeiro_total} anterior={d.gastos.financeiro_total_anterior} inverso /></>} tone="amber" hint={`Campo: ${brl(d.gastos.rotas)}`} />
            <StatCard label="WhatsApp" value={d.whatsapp.conversas} tone="accent" hint={`${d.whatsapp.sla_estourado} fora do SLA · ${d.whatsapp.leads_convertidos}/${d.whatsapp.leads} leads convertidos`} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Rotas e campo" icon={<CalendarRange className="h-4 w-4" />} />
              <CardBody>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted">Rotas</dt><dd className="font-semibold">{n("rotas")}<Var atual={n("rotas")} anterior={n("rotas", a)} /></dd></div>
                  <div><dt className="text-muted">Km</dt><dd className="font-semibold">{num(n("km"))}<Var atual={n("km")} anterior={n("km", a)} inverso /></dd></div>
                  <div><dt className="text-muted">Check-ins</dt><dd className="font-semibold">{n("checkins")}</dd></div>
                  <div><dt className="text-muted">Cumprimento</dt><dd className="font-semibold">{n("paradas") ? `${((n("paradas_visitadas") / n("paradas")) * 100).toFixed(0)}%` : "—"}</dd></div>
                  <div><dt className="text-muted">Locomoção</dt><dd className="font-semibold">{Math.round(n("tempo_locomocao_min") / 60)} h</dd></div>
                  <div><dt className="text-muted">Fora do raio</dt><dd className="font-semibold">{n("checkins_fora_raio")}</dd></div>
                </dl>
                <p className="mt-4 text-xs text-muted">Despesas de rota: {Object.entries(d.gastos.despesas_rota).map(([k, v]) => `${k} ${brl(v)}`).join(" · ") || "nenhuma"}</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Clientes e documentação" />
              <CardBody>
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div><dt className="text-muted">Pendentes hoje</dt><dd className="font-semibold">{d.documentacao.pendentes_hoje}</dd></div>
                  <div><dt className="text-muted">Concluídas no mês</dt><dd className="font-semibold">{d.documentacao.completas_no_mes}</dd></div>
                  <div><dt className="text-muted">Transferidos (45 dias)</dt><dd className="font-semibold">{d.documentacao.transferidos_45}<Var atual={d.documentacao.transferidos_45} anterior={n("transferidos_45", a)} inverso /></dd></div>
                </dl>
                <p className="mt-4 text-xs text-muted">Por origem: {Object.entries(d.clientes.por_origem).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}</p>
                <p className="mt-1 text-xs text-muted">Por cidade: {d.clientes.por_cidade.map((c) => `${c.cidade} ${c.n}`).join(" · ") || "—"}</p>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Ranking de consultores" description={`Pontos = ${PESOS.map(([k, l]) => `${l} × ${d.pesos?.[k] ?? 0}`).join(" + ")}`} icon={<Trophy className="h-4 w-4" />} />
            {!d.ranking.length ? <EmptyState title="Sem atividade de consultores" /> : (
              <div className="overflow-x-auto"><table className="table-base">
                <thead><tr><th>#</th><th>Consultor</th><th className="text-right">Pontos</th><th className="text-right">Clientes</th><th className="text-right">Vendas</th><th className="text-right">Visitas</th><th className="text-right">Km</th><th className="text-right">Custo/cliente</th></tr></thead>
                <tbody>{d.ranking.map((c, k) => (
                  <tr key={c.consultor_id}><td>{k + 1}</td><td className="font-medium">{c.nome}</td><td className="text-right font-semibold">{c.pontos}</td><td className="text-right">{n("clientes_novos", c.m)}</td><td className="text-right">{n("vendas_aprovadas", c.m)}</td>
                    <td className="text-right">{n("paradas_visitadas", c.m)}</td><td className="text-right">{num(n("km", c.m))}</td><td className="text-right">{c.custo_por_cliente != null ? brl(c.custo_por_cliente) : "—"}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Vendas" description={Object.entries(d.vendas.por_situacao).map(([k, v]) => `${vendas[k]?.label ?? k}: ${v}`).join(" · ")} />
              {!d.vendas.lista.length ? <EmptyState title="Nenhuma venda pendente ou cancelada" /> : (
                <table className="table-base"><thead><tr><th>Situação</th><th>Cliente</th><th>Negócio</th><th className="text-right">Valor</th></tr></thead>
                  <tbody>{d.vendas.lista.map((v, k) => <tr key={k}><td className="text-xs">{vendas[v.situacao]?.label}</td><td className="text-sm">{v.cliente}<span className="block text-[11px] text-muted">{v.consultor}</span></td><td className="text-sm">{v.titulo}</td><td className="text-right text-sm">{brl(v.valor)}</td></tr>)}</tbody></table>
              )}
            </Card>
            <Card>
              <CardHeader title="Processos encaminhados ao jurídico" description={Object.entries(d.processos.por_situacao).map(([k, v]) => `${encaminh[k]?.label ?? k}: ${v}`).join(" · ")} />
              {!d.processos.lista.length ? <EmptyState title="Nenhum processo pendente" /> : (
                <table className="table-base"><thead><tr><th>Situação</th><th>Processo</th><th>Cliente</th></tr></thead>
                  <tbody>{d.processos.lista.map((v, k) => <tr key={k}><td className="text-xs">{encaminh[v.situacao]?.label}</td><td className="text-sm">{v.titulo}</td><td className="text-sm">{v.cliente}</td></tr>)}</tbody></table>
              )}
            </Card>
          </div>
          <Card className="print:hidden">
            <CardHeader title="Gastos por categoria (financeiro)" icon={<Settings className="h-4 w-4" />} />
            <ul className="divide-y divide-line text-sm">{Object.entries(d.gastos.financeiro).sort(([, x], [, y]) => y - x).map(([k, v]) => <li key={k} className="flex justify-between px-5 py-2"><span>{k}</span><span>{brl(v)}</span></li>)}</ul>
          </Card>
        </div>
      )}
    </>
  );
}
