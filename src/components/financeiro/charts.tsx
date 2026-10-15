"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { VIZ_VARS, vizColor } from "@/components/dashboard/charts";

const AXIS_TICK = { fill: "rgb(var(--muted))", fontSize: 11 };
const GRID = "rgb(var(--line))";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compact = (v: number) => v.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export interface FinPoint {
  label: string;
  receitas: number;
  despesas: number;
}

const SERIES = [
  { key: "receitas", label: "Receitas recebidas", color: vizColor(0) },
  { key: "despesas", label: "Despesas pagas", color: vizColor(1) },
] as const;

/** Receitas × despesas realizadas por mês (mesma unidade, um eixo). */
export function ReceitasDespesasChart({ data }: { data: FinPoint[] }) {
  const tot = { receitas: data.reduce((a, d) => a + d.receitas, 0), despesas: data.reduce((a, d) => a + d.despesas, 0) };
  if (!tot.receitas && !tot.despesas) return <p className="py-12 text-center text-sm text-muted">Sem movimentação financeira nos últimos 12 meses.</p>;
  return (
    <div className={cn(VIZ_VARS)}>
      <ul className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" aria-label="Legenda">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-fg">{s.label}</span>
            <strong className="font-semibold tabular-nums">{brl(tot[s.key])}</strong>
          </li>
        ))}
      </ul>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
            <Tooltip
              cursor={{ fill: "rgb(var(--surface-2))" }}
              formatter={(v: number, name: string) => [brl(v), SERIES.find((s) => s.key === name)?.label ?? name]}
              contentStyle={{ background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", borderRadius: 12, fontSize: 12 }}
            />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
