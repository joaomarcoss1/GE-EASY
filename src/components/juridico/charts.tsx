"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { VIZ_VARS, vizColor } from "@/components/dashboard/charts";

const AXIS_TICK = { fill: "rgb(var(--muted))", fontSize: 11 };
const GRID = "rgb(var(--line))";

export interface FluxoPoint {
  mes: string;
  label: string;
  novos: number;
  encerrados: number;
}

const SERIES = [
  { key: "novos", label: "Novos", color: vizColor(0) },
  { key: "encerrados", label: "Encerrados", color: vizColor(1) },
] as const;

/**
 * Novos × encerrados por mês — mesma unidade (quantidade), um único eixo.
 * Série 1 = índigo da marca, série 2 = laranja da marca (paleta validada em VIZ_VARS).
 */
export function FluxoProcessosChart({ data }: { data: FluxoPoint[] }) {
  const totals = { novos: data.reduce((a, d) => a + d.novos, 0), encerrados: data.reduce((a, d) => a + d.encerrados, 0) };
  if (!totals.novos && !totals.encerrados) return <p className="py-12 text-center text-sm text-muted">Sem movimentação de processos nos últimos 12 meses.</p>;
  return (
    <div className={cn(VIZ_VARS)}>
      <ul className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" aria-label="Legenda">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-fg">{s.label}</span>
            <span className="text-muted">
              12 meses: <strong className="font-semibold tabular-nums text-fg">{totals[s.key].toLocaleString("pt-BR")}</strong>
            </span>
          </li>
        ))}
      </ul>
      <div className="h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} tickMargin={6} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgb(var(--surface-2))" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as FluxoPoint;
                return (
                  <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
                    <p className="mb-1 font-semibold text-fg">{String(label)}</p>
                    {SERIES.map((s) => (
                      <div key={s.key} className="flex items-center gap-2 py-0.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                        <span className="text-muted">{s.label}</span>
                        <span className="ml-auto pl-3 font-semibold tabular-nums text-fg">{p[s.key].toLocaleString("pt-BR")}</span>
                      </div>
                    ))}
                    <div className="mt-1 border-t border-line pt-1 text-muted">
                      Saldo: <span className="font-semibold text-fg">{(p.novos - p.encerrados > 0 ? "+" : "") + (p.novos - p.encerrados).toLocaleString("pt-BR")}</span>
                    </div>
                  </div>
                );
              }}
            />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
