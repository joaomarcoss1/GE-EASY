"use client";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";

/**
 * Paleta categórica validada (scripts do skill dataviz) para superfície clara e
 * escura. Slot 1 = índigo da marca (consórcio), slot 2 = laranja da marca (seguros).
 * Cores aplicadas via CSS vars para alternar no modo escuro sem re-render.
 */
export const VIZ_VARS =
  "[--viz-1:#4F4FC4] [--viz-2:#E14F26] [--viz-3:#1baf7a] [--viz-4:#eda100] [--viz-5:#e87ba4] [--viz-6:#008300] [--viz-other:#9ca3af] " +
  "dark:[--viz-1:#7B7BD3] dark:[--viz-2:#E14F26] dark:[--viz-3:#199e70] dark:[--viz-4:#c98500] dark:[--viz-5:#d55181] dark:[--viz-6:#008300] dark:[--viz-other:#6b7280]";

export const vizColor = (i: number) => `var(--viz-${i + 1})`;

const AXIS_TICK = { fill: "rgb(var(--muted))", fontSize: 11 };
const GRID = "rgb(var(--line))";
const compactBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const fullBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function TooltipBox({ title, rows }: { title?: string; rows: { color: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      {title && <p className="mb-1 font-semibold text-fg">{title}</p>}
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
          <span className="text-muted">{r.label}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-fg">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Produção mensal — small multiples (crédito de consórcio e prêmio de seguros
// têm escalas muito diferentes: um eixo por painel, nunca eixo duplo).
// ---------------------------------------------------------------------------
export interface ProducaoPoint {
  mes: string;
  label: string;
  consorcio: number;
  seguro: number;
}

function MonthlyPanel({ data, dataKey, color, title }: { data: ProducaoPoint[]; dataKey: "consorcio" | "seguro"; color: string; title: string }) {
  const total = data.reduce((a, d) => a + d[dataKey], 0);
  const lastIdx = data.length - 1;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
        <span className="font-medium text-fg">{title}</span>
        <span className="ml-auto text-muted">
          12 meses: <span className="font-semibold text-fg">{compactBRL.format(total)}</span>
        </span>
      </div>
      <div className="h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} tickMargin={6} fontSize={11} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => compactBRL.format(v)} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "rgb(var(--surface-2))" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? <TooltipBox title={String(label)} rows={[{ color, label: title, value: fullBRL.format(Number(payload[0].value ?? 0)) }]} /> : null
              }
            />
            <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              <LabelList
                dataKey={dataKey}
                content={(p) => {
                  const { x, y, width, value, index } = p as { x: number; y: number; width: number; value: number; index: number };
                  if (index !== lastIdx || !value) return null;
                  return (
                    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="rgb(var(--fg))">
                      {compactBRL.format(value)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ProducaoChart({ data }: { data: ProducaoPoint[] }) {
  return (
    <div className={cn("space-y-4", VIZ_VARS)}>
      <MonthlyPanel data={data} dataKey="consorcio" color={vizColor(0)} title="Consórcio · crédito vendido" />
      <MonthlyPanel data={data} dataKey="seguro" color={vizColor(1)} title="Seguros · prêmio emitido" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais (funil, rankings) — série única, rótulo na ponta.
// ---------------------------------------------------------------------------
export interface HBarPoint {
  label: string;
  value: number;
  /** Rótulo exibido na ponta da barra (pré-formatado no servidor). */
  display: string;
  /** Linha extra no tooltip. */
  detail?: string;
}

export function HBarChart({ data, colorIndex = 0, labelWidth = 110, emptyText = "Sem dados no período." }: { data: HBarPoint[]; colorIndex?: number; labelWidth?: number; emptyText?: string }) {
  if (!data.length || data.every((d) => !d.value)) return <p className="py-10 text-center text-sm text-muted">{emptyText}</p>;
  const color = vizColor(colorIndex);
  const height = data.length * 38 + 8;
  return (
    <div className={VIZ_VARS} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 120, bottom: 4, left: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="label" width={labelWidth} tick={{ ...AXIS_TICK, fontSize: 12, fill: "rgb(var(--fg))" }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgb(var(--surface-2))" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as HBarPoint;
              return <TooltipBox title={p.label} rows={[{ color, label: p.detail ?? "Valor", value: p.display }]} />;
            }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false} minPointSize={2}>
            <LabelList dataKey="display" position="right" offset={8} fill="rgb(var(--fg))" fontSize={12} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rosca (parte-do-todo) — no máximo 6 fatias; legenda com valores sempre visível.
// ---------------------------------------------------------------------------
export interface DonutSlice {
  label: string;
  value: number;
  display: string;
}

/** Mantém as 5 maiores e agrupa o resto em "Outros". */
function foldSlices(data: DonutSlice[], otherDisplay: (v: number) => string): (DonutSlice & { color: string })[] {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, sorted.length > 6 ? 5 : 6).map((d, i) => ({ ...d, color: vizColor(i) }));
  const tail = sorted.slice(head.length);
  if (tail.length) {
    const v = tail.reduce((a, d) => a + d.value, 0);
    head.push({ label: "Outros", value: v, display: otherDisplay(v), color: "var(--viz-other)" });
  }
  return head;
}

export function DonutChart({ data, centerLabel, centerValue, money = true }: { data: DonutSlice[]; centerLabel: string; centerValue: string; money?: boolean }) {
  const slices = foldSlices(data, (v) => (money ? compactBRL.format(v) : v.toLocaleString("pt-BR")));
  const total = slices.reduce((a, d) => a + d.value, 0);
  if (!total) return <p className="py-12 text-center text-sm text-muted">Nenhum registro ativo.</p>;
  return (
    <div className={cn("flex flex-col items-center gap-5 sm:flex-row", VIZ_VARS)}>
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius={60} outerRadius={84} startAngle={90} endAngle={-270} stroke="rgb(var(--surface))" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const s = payload[0].payload as DonutSlice & { color: string };
                return <TooltipBox rows={[{ color: s.color, label: s.label, value: `${s.display} · ${((s.value / total) * 100).toFixed(1).replace(".", ",")}%` }]} />;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[11px] text-muted">{centerLabel}</p>
            <p className="text-base font-bold">{centerValue}</p>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2 text-sm">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="font-semibold tabular-nums">{s.display}</span>
            <span className="w-12 text-right text-xs tabular-nums text-muted">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rosca com alternância entre consórcio (categorias) e seguros (ramos). */
export function CarteiraDonut({
  consorcio,
  seguro,
  totals,
}: {
  consorcio: DonutSlice[];
  seguro: DonutSlice[];
  totals: { consorcio: string; seguro: string; cotas: number; apolices: number };
}) {
  const [tab, setTab] = useState<"consorcio" | "seguro">("consorcio");
  return (
    <div>
      <div className="mb-4 inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface-2 p-1" role="tablist" aria-label="Linha de negócio">
        {(
          [
            ["consorcio", `Consórcio (${totals.cotas})`],
            ["seguro", `Seguros (${totals.apolices})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("rounded-lg px-3 py-1 text-xs font-medium transition", tab === k ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "consorcio" ? (
        <DonutChart data={consorcio} centerLabel="Crédito ativo" centerValue={totals.consorcio} />
      ) : (
        <DonutChart data={seguro} centerLabel="Prêmio vigente" centerValue={totals.seguro} />
      )}
    </div>
  );
}
