import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, Landmark, PiggyBank, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clienteOptions, departamentoOptions, processoOptions } from "@/lib/data";
import { FIN_CATEGORIAS_DESPESA, FIN_CATEGORIAS_RECEITA, FIN_STATUS } from "@/lib/constants";
import { brl, brlShort, date, monthLabel, todayISO } from "@/lib/format";
import type { FinanceiroLancamento } from "@/lib/types";
import { baixarEmLote, baixarLancamento, cancelarLancamento, deleteLancamento, estornarLancamento, saveLancamento } from "@/lib/actions/financeiro";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, SearchInput, SegmentTabs } from "@/components/ui/filters";
import { DonutChart } from "@/components/dashboard/charts";
import { MonthPicker } from "@/components/comissoes/month-picker";
import { ReceitasDespesasChart } from "@/components/financeiro/charts";
import { lancamentoFields } from "@/components/financeiro/fields";
import { LancamentosTable, type LancRow } from "@/components/financeiro/lancamentos-table";

export const metadata: Metadata = { title: "Financeiro" };

type Row = FinanceiroLancamento & { clientes: { id: string; nome: string } | null; processos: { id: string; titulo: string } | null };

function mesRange(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const ini = `${y}-${String(m).padStart(2, "0")}-01`;
  const fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { ini, fim };
}

export default async function FinanceiroPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("financeiro.view");
  const sp = await searchParams;
  const hoje = todayISO();
  const mes = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hoje.slice(0, 7);
  const { ini, fim } = mesRange(mes);
  const aba = sp.aba ?? "visao";
  const supabase = await createClient();

  const [y, m] = mes.split("-").map(Number);
  const ini12 = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);

  const sel = "*, clientes(id, nome), processos(id, titulo)";
  const [mesRes, atrasadosRes, historicoRes, clientes, processos, departamentos] = await Promise.all([
    supabase.from("financeiro_lancamentos").select(sel).gte("vencimento", ini).lte("vencimento", fim).order("vencimento").limit(3000),
    supabase.from("financeiro_lancamentos").select(sel).eq("status", "aberto").lt("vencimento", hoje).order("vencimento").limit(2000),
    supabase.from("financeiro_lancamentos").select("tipo, valor, valor_pago, data_pagamento").eq("status", "pago").gte("data_pagamento", ini12).lte("data_pagamento", fim).limit(10000),
    clienteOptions(),
    processoOptions(),
    departamentoOptions(),
  ]);
  const doMes = (mesRes.data ?? []) as unknown as Row[];
  const atrasados = (atrasadosRes.data ?? []) as unknown as Row[];
  const ativos = doMes.filter((l) => l.status !== "cancelado");
  const soma = (arr: Row[]) => arr.reduce((a, l) => a + Number(l.valor), 0);

  const receitas = ativos.filter((l) => l.tipo === "receita");
  const despesas = ativos.filter((l) => l.tipo === "despesa");
  const recebido = soma(receitas.filter((l) => l.status === "pago"));
  const pago = soma(despesas.filter((l) => l.status === "pago"));
  const inadimplencia = soma(atrasados.filter((l) => l.tipo === "receita"));
  const despAtrasadas = soma(atrasados.filter((l) => l.tipo === "despesa"));

  // Histórico 12 meses (regime de caixa)
  const meses = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 12 + i, 1)).toISOString().slice(0, 7));
  const hist = new Map(meses.map((k) => [k, { receitas: 0, despesas: 0 }]));
  for (const h of historicoRes.data ?? []) {
    const k = String(h.data_pagamento).slice(0, 7);
    const bucket = hist.get(k);
    if (bucket) bucket[h.tipo === "receita" ? "receitas" : "despesas"] += Number(h.valor_pago ?? h.valor);
  }
  const chart = meses.map((k) => ({ label: monthLabel(k), ...hist.get(k)! }));

  const porCategoria = new Map<string, number>();
  for (const d of despesas) porCategoria.set(d.categoria, (porCategoria.get(d.categoria) ?? 0) + Number(d.valor));
  const devedores = new Map<string, { nome: string; id: string; valor: number }>();
  for (const l of atrasados.filter((l) => l.tipo === "receita" && l.clientes)) {
    const c = l.clientes!;
    const cur = devedores.get(c.id) ?? { nome: c.nome, id: c.id, valor: 0 };
    cur.valor += Number(l.valor);
    devedores.set(c.id, cur);
  }

  const opts = { clientes, processos, departamentos };
  const fields = { receita: lancamentoFields("receita", opts, false), despesa: lancamentoFields("despesa", opts, false) };
  const toRow = (l: Row): LancRow => ({
    id: l.id,
    tipo: l.tipo,
    categoria: l.categoria,
    descricao: l.descricao,
    valor: Number(l.valor),
    vencimento: l.vencimento,
    data_pagamento: l.data_pagamento,
    status: l.status,
    cliente: l.clientes,
    processo: l.processos,
    parcela: l.parcela,
    total_parcelas: l.total_parcelas,
    reembolsavel: l.reembolsavel,
    values: { ...l, clientes: undefined, processos: undefined } as unknown as LancRow["values"],
  });
  const actions = { save: saveLancamento, baixar: baixarLancamento, estornar: estornarLancamento, cancelar: cancelarLancamento, remove: deleteLancamento, lote: baixarEmLote };

  const filtrar = (tipo: "receita" | "despesa") => {
    let list = doMes.filter((l) => l.tipo === tipo);
    if (sp.vencidos === "1") list = atrasados.filter((l) => l.tipo === tipo);
    if (sp.status) list = list.filter((l) => l.status === sp.status);
    if (sp.cat) list = list.filter((l) => l.categoria === sp.cat);
    const q = (sp.q ?? "").toLowerCase().trim();
    if (q) list = list.filter((l) => `${l.descricao} ${l.clientes?.nome ?? ""} ${l.fornecedor ?? ""}`.toLowerCase().includes(q));
    return list;
  };

  // Fluxo de caixa diário do mês: abertos + realizados, saldo acumulado
  const dias = new Map<string, { entradas: number; saidas: number }>();
  for (const l of ativos) {
    const k = l.status === "pago" && l.data_pagamento ? l.data_pagamento : l.vencimento;
    if (k < ini || k > fim) continue;
    const cur = dias.get(k) ?? { entradas: 0, saidas: 0 };
    cur[l.tipo === "receita" ? "entradas" : "saidas"] += Number(l.valor);
    dias.set(k, cur);
  }
  let saldo = 0;
  const fluxo = [...dias.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ((saldo += v.entradas - v.saidas), { d, ...v, saldo }));

  const novoBtn = (tipo: "receita" | "despesa") => (
    <FormDrawerButton
      action={saveLancamento}
      fields={lancamentoFields(tipo, opts, true)}
      values={{ tipo, categoria: tipo === "receita" ? FIN_CATEGORIAS_RECEITA[0].value : FIN_CATEGORIAS_DESPESA[0].value, status: "aberto", vencimento: hoje, repetir: 1 }}
      title={tipo === "receita" ? "Nova receita" : "Nova despesa"}
      label={tipo === "receita" ? "Nova receita" : "Nova despesa"}
      variant={tipo === "receita" ? "accent" : "secondary"}
      width="max-w-2xl"
      defaultOpen={sp.novo === tipo}
    />
  );

  return (
    <>
      <PageHeader
        eyebrow="Escritório"
        title="Financeiro"
        description="Contas a receber e a pagar, honorários, despesas e fluxo de caixa do escritório."
        actions={
          <>
            <Suspense>
              <MonthPicker value={mes} />
            </Suspense>
            {novoBtn("despesa")}
            {novoBtn("receita")}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="A receber no mês" value={brlShort(soma(receitas))} hint={`Recebido: ${brl(recebido)}`} icon={<ArrowDownCircle className="h-5 w-5" />} />
        <StatCard label="A pagar no mês" value={brlShort(soma(despesas))} hint={`Pago: ${brl(pago)}`} icon={<ArrowUpCircle className="h-5 w-5" />} tone="accent" />
        <StatCard label="Saldo realizado no mês" value={brlShort(recebido - pago)} icon={<PiggyBank className="h-5 w-5" />} tone={recebido - pago >= 0 ? "green" : "accent"} />
        <StatCard label="Inadimplência (receitas vencidas)" value={brlShort(inadimplencia)} hint={despAtrasadas ? `Contas vencidas a pagar: ${brl(despAtrasadas)}` : undefined} icon={<AlertTriangle className="h-5 w-5" />} tone="amber" />
      </div>

      <div className="mb-5">
        <SegmentTabs
          param="aba"
          options={[
            { value: "visao", label: "Visão geral" },
            { value: "receber", label: "Contas a receber" },
            { value: "pagar", label: "Contas a pagar" },
            { value: "fluxo", label: "Fluxo de caixa" },
          ]}
        />
      </div>

      {aba === "visao" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Receitas × despesas (12 meses, regime de caixa)" icon={<Landmark className="h-4 w-4" />} />
            <CardBody>
              <ReceitasDespesasChart data={chart} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Despesas do mês por categoria" icon={<Wallet className="h-4 w-4" />} />
            <CardBody>
              <DonutChart data={[...porCategoria.entries()].map(([label, value]) => ({ label, value, display: brl(value) }))} centerLabel="Despesas" centerValue={brlShort(soma(despesas))} />
            </CardBody>
          </Card>
          <Card className="xl:col-span-3">
            <CardHeader title="Maiores devedores (receitas vencidas)" description="Clientes com honorários em atraso" />
            {devedores.size === 0 ? (
              <EmptyState title="Nenhum cliente em atraso" description="Todas as receitas vencidas estão quitadas." />
            ) : (
              <ul className="divide-y divide-line">
                {[...devedores.values()]
                  .sort((a, b) => b.valor - a.valor)
                  .slice(0, 8)
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <Link href={`/clientes/${d.id}`} className="font-medium hover:text-brand-600">{d.nome}</Link>
                      <b className="tabular-nums text-red-600">{brl(d.valor)}</b>
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {(aba === "receber" || aba === "pagar") && (
        <Card>
          <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
            <SearchInput placeholder="Descrição, cliente, fornecedor…" />
            <FilterSelect param="status" options={FIN_STATUS} allLabel="Qualquer situação" />
            <FilterSelect param="cat" options={aba === "receber" ? FIN_CATEGORIAS_RECEITA : FIN_CATEGORIAS_DESPESA} allLabel="Todas as categorias" />
            <FilterSelect param="vencidos" options={[{ value: "1", label: "Somente vencidos (todos os meses)" }]} allLabel="Vencimentos do mês" />
          </div>
          {(() => {
            const list = filtrar(aba === "receber" ? "receita" : "despesa");
            return list.length === 0 ? (
              <EmptyState title="Nenhum lançamento" description="Ajuste os filtros ou cadastre um novo lançamento." />
            ) : (
              <LancamentosTable rows={list.map(toRow)} editFields={fields} canManage actions={actions} />
            );
          })()}
        </Card>
      )}

      {aba === "fluxo" && (
        <Card>
          <CardHeader title="Fluxo de caixa do mês" description="Previsto (em aberto pelo vencimento) + realizado (pela data de pagamento), com saldo acumulado" />
          {fluxo.length === 0 ? (
            <EmptyState title="Sem movimentação no mês" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th className="text-right">Entradas</th>
                    <th className="text-right">Saídas</th>
                    <th className="text-right">Saldo do dia</th>
                    <th className="text-right">Saldo acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {fluxo.map((f) => (
                    <tr key={f.d}>
                      <td className="text-sm font-medium">{date(f.d)}</td>
                      <td className="text-right tabular-nums text-emerald-600">{f.entradas ? brl(f.entradas) : "—"}</td>
                      <td className="text-right tabular-nums text-red-600">{f.saidas ? brl(f.saidas) : "—"}</td>
                      <td className="text-right tabular-nums">{brl(f.entradas - f.saidas)}</td>
                      <td className={`text-right font-semibold tabular-nums ${f.saldo < 0 ? "text-red-600" : ""}`}>{brl(f.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
