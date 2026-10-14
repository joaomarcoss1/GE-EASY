"use client";
import { useMemo, useState } from "react";
import { Printer, RotateCcw, Sparkles, TrendingDown, Landmark, Banknote, Gavel, Scale, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { brl, pct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export interface SimuladorInicial {
  credito?: number;
  prazo?: number;
  taxaAdm?: number;
  fundoReserva?: number;
  cliente?: string;
}

const DEFAULTS = { credito: 300000, prazo: 200, taxaAdm: 18, fundoReserva: 2, seguro: 0, lanceEmbutido: 0, lanceLivre: 0, mesContemplacao: 12, juros: 1.39 };

/** "1.234,56" | "1234.56" | "1234" -> número */
function parseBR(v: string): number {
  const s = v.replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  let n: number;
  if (s.includes(",")) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, "")); // "300.000" = milhar
  else n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
const fmtNum = (n: number, digits = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Parcela pela tabela Price: PV · i / (1 − (1 + i)^−n) */
function price(pv: number, iMensal: number, n: number) {
  if (n <= 0) return 0;
  if (iMensal <= 0) return pv / n;
  return (pv * iMensal) / (1 - Math.pow(1 + iMensal, -n));
}

export function Simulador({ inicial }: { inicial?: SimuladorInicial }) {
  const start = {
    credito: fmtNum(inicial?.credito ?? DEFAULTS.credito),
    prazo: String(inicial?.prazo ?? DEFAULTS.prazo),
    taxaAdm: fmtNum(inicial?.taxaAdm ?? DEFAULTS.taxaAdm, 3),
    fundoReserva: fmtNum(inicial?.fundoReserva ?? DEFAULTS.fundoReserva, 3),
    seguro: fmtNum(DEFAULTS.seguro, 4),
    lanceEmbutido: fmtNum(DEFAULTS.lanceEmbutido),
    lanceLivre: fmtNum(DEFAULTS.lanceLivre),
    mesContemplacao: String(DEFAULTS.mesContemplacao),
    juros: fmtNum(DEFAULTS.juros, 3),
    cliente: inicial?.cliente ?? "",
  };
  const [f, setF] = useState(start);
  const set = (k: keyof typeof start) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const r = useMemo(() => {
    const credito = Math.max(0, parseBR(f.credito));
    const prazo = Math.round(clamp(parseBR(f.prazo), 1, 400));
    const adm = clamp(parseBR(f.taxaAdm), 0, 100);
    const fr = clamp(parseBR(f.fundoReserva), 0, 100);
    const seg = clamp(parseBR(f.seguro), 0, 10);
    const lePct = clamp(parseBR(f.lanceEmbutido), 0, 100);
    const lanceLivre = Math.max(0, parseBR(f.lanceLivre));
    const mes = Math.round(clamp(parseBR(f.mesContemplacao), 1, prazo));
    const juros = clamp(parseBR(f.juros), 0, 20) / 100;

    const taxaAdmValor = (credito * adm) / 100;
    const fundoValor = (credito * fr) / 100;
    const valorPlano = credito + taxaAdmValor + fundoValor;
    const fundoComumMensal = credito / prazo;
    const admMensal = taxaAdmValor / prazo;
    const frMensal = fundoValor / prazo;
    const seguroMensal = (valorPlano * seg) / 100;
    const parcelaBase = valorPlano / prazo;
    const parcela = parcelaBase + seguroMensal;
    const seguroTotal = seguroMensal * prazo;
    const custoTotal = valorPlano + seguroTotal;
    const custoEncargos = custoTotal - credito;

    // Lances
    const lanceEmbutido = (credito * lePct) / 100;
    const saldoNaContemplacao = Math.max(0, valorPlano - parcelaBase * mes);
    const lanceTotal = Math.min(lanceEmbutido + lanceLivre, saldoNaContemplacao);
    const lancePct = credito ? ((lanceEmbutido + lanceLivre) / credito) * 100 : 0;
    const creditoLiquido = Math.max(0, credito - lanceEmbutido);
    const saldoPosLance = Math.max(0, saldoNaContemplacao - lanceTotal);
    const restantes = prazo - mes;
    const parcelaReduzida = restantes > 0 ? saldoPosLance / restantes + seguroMensal : 0;
    const prazoReduzido = parcelaBase > 0 ? Math.ceil(saldoPosLance / parcelaBase) : 0;
    const mesesEconomizados = Math.max(0, restantes - prazoReduzido);

    // Desembolso do cliente (o lance embutido sai do próprio crédito)
    const desembolsoConsorcio = Math.max(0, custoTotal - lanceEmbutido);

    // Financiamento do mesmo valor líquido, no mesmo prazo (Price)
    const pmt = price(creditoLiquido, juros, prazo);
    const totalFinanciamento = pmt * prazo;
    const jurosFinanciamento = totalFinanciamento - creditoLiquido;
    const economia = totalFinanciamento - desembolsoConsorcio;

    return {
      credito, prazo, adm, fr, seg, mes, juros,
      taxaAdmValor, fundoValor, valorPlano, fundoComumMensal, admMensal, frMensal, seguroMensal, parcelaBase, parcela, seguroTotal, custoTotal, custoEncargos,
      lanceEmbutido, lanceLivre, lanceTotal, lancePct, creditoLiquido, saldoNaContemplacao, saldoPosLance, restantes, parcelaReduzida, prazoReduzido, mesesEconomizados,
      desembolsoConsorcio, pmt, totalFinanciamento, jurosFinanciamento, economia,
    };
  }, [f]);

  const composicao = [
    { label: "Fundo comum", value: r.fundoComumMensal, cls: "bg-brand-600" },
    { label: "Taxa de administração", value: r.admMensal, cls: "bg-accent-500" },
    { label: "Fundo de reserva", value: r.frMensal, cls: "bg-violet-500" },
    { label: "Seguro prestamista", value: r.seguroMensal, cls: "bg-sky-500" },
  ].filter((c) => c.value > 0);
  const maxTotal = Math.max(r.desembolsoConsorcio, r.totalFinanciamento, 1);
  const hoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="grid gap-6 xl:grid-cols-[400px_1fr]">
      {/* Cabeçalho exclusivo da impressão */}
      <div className="hidden print:block xl:col-span-2">
        <div className="flex items-end justify-between border-b-2 border-brand-700 pb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-600">EASY Consórcio & Seguros</p>
            <h2 className="text-2xl font-bold text-brand-800">Proposta de consórcio</h2>
            {f.cliente && <p className="mt-1 text-sm">Cliente: <b>{f.cliente}</b></p>}
          </div>
          <p className="text-sm text-muted" suppressHydrationWarning>{hoje}</p>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
          <PrintItem label="Crédito" value={brl(r.credito)} />
          <PrintItem label="Prazo" value={`${r.prazo} meses`} />
          <PrintItem label="Taxa de administração" value={pct(r.adm, 3)} />
          <PrintItem label="Fundo de reserva" value={pct(r.fr, 3)} />
        </div>
      </div>

      <Card className="no-print h-fit xl:sticky xl:top-24">
        <CardHeader title="Parâmetros da simulação" description="Os resultados são atualizados em tempo real" icon={<Sparkles className="h-4 w-4" />} />
        <CardBody className="space-y-5">
          <TextField label="Cliente (opcional)" value={f.cliente} onChange={set("cliente")} placeholder="Nome para a proposta impressa" />
          <NumField label="Crédito desejado" prefix="R$" value={f.credito} onChange={set("credito")} range={{ min: 10000, max: 2000000, step: 5000 }} digits={2} />
          <NumField label="Prazo" suffix="meses" value={f.prazo} onChange={set("prazo")} range={{ min: 12, max: 240, step: 1 }} digits={0} chips={[60, 100, 150, 200, 240]} />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Taxa de administração" suffix="%" value={f.taxaAdm} onChange={set("taxaAdm")} digits={3} help="Total do plano" />
            <NumField label="Fundo de reserva" suffix="%" value={f.fundoReserva} onChange={set("fundoReserva")} digits={3} />
          </div>
          <NumField label="Seguro prestamista (opcional)" suffix="% a.m." value={f.seguro} onChange={set("seguro")} digits={4} help="Percentual mensal sobre o valor do plano" />

          <div className="flex items-center gap-3 pt-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">
            Lances <span className="h-px flex-1 bg-line" />
          </div>
          <NumField label="Lance embutido" suffix="% do crédito" value={f.lanceEmbutido} onChange={set("lanceEmbutido")} range={{ min: 0, max: 50, step: 1 }} digits={2} />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Lance livre" prefix="R$" value={f.lanceLivre} onChange={set("lanceLivre")} digits={2} />
            <NumField label="Contemplação no mês" value={f.mesContemplacao} onChange={set("mesContemplacao")} digits={0} />
          </div>

          <div className="flex items-center gap-3 pt-1 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">
            Comparativo <span className="h-px flex-1 bg-line" />
          </div>
          <NumField label="Juros do financiamento" suffix="% a.m." value={f.juros} onChange={set("juros")} digits={3} help="Taxa mensal de um financiamento equivalente (tabela Price)" />

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="accent" onClick={() => window.print()} className="flex-1">
              <Printer className="h-4 w-4" /> Imprimir proposta
            </Button>
            <Button type="button" variant="secondary" onClick={() => setF(start)} aria-label="Restaurar valores">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="min-w-0 space-y-6">
        {/* Destaque */}
        <div className="brand-gradient relative overflow-hidden rounded-2xl p-6 text-white shadow-card print:border print:border-line">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-white/70">Parcela mensal</p>
              <p className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">{brl(r.parcela)}</p>
              <p className="mt-2 text-sm text-white/70">
                {r.prazo} parcelas · crédito de {brl(r.credito)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
              <Hero label="Custo total do plano" value={brl(r.custoTotal)} />
              <Hero label="Crédito líquido" value={brl(r.creditoLiquido)} highlight={r.lanceEmbutido > 0} />
              <Hero label="Encargos totais" value={brl(r.custoEncargos)} />
              <Hero label="Custo sobre o crédito" value={pct(r.credito ? (r.custoEncargos / r.credito) * 100 : 0, 2)} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Composição da parcela" icon={<Landmark className="h-4 w-4" />} description={`Valor do plano: ${brl(r.valorPlano)}`} />
            <CardBody>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
                {composicao.map((c) => (
                  <div key={c.label} className={cn("h-full transition-all", c.cls)} style={{ width: `${r.parcela ? (c.value / r.parcela) * 100 : 0}%` }} title={c.label} />
                ))}
              </div>
              <ul className="mt-4 space-y-2.5 text-sm">
                {composicao.map((c) => (
                  <li key={c.label} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-muted">
                      <span className={cn("h-2.5 w-2.5 rounded-full", c.cls)} /> {c.label}
                    </span>
                    <span className="font-medium tabular-nums">{brl(c.value)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 border-t border-line pt-2.5 font-semibold">
                  <span>Parcela</span>
                  <span className="tabular-nums">{brl(r.parcela)}</span>
                </li>
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <Mini label="Taxa de administração" value={brl(r.taxaAdmValor)} />
                <Mini label="Fundo de reserva" value={brl(r.fundoValor)} />
                {r.seguroTotal > 0 && <Mini label="Seguro no período" value={brl(r.seguroTotal)} />}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Estratégia de lance" icon={<Gavel className="h-4 w-4" />} description={`Contemplação simulada no mês ${r.mes}`} />
            <CardBody className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <Mini label="Embutido" value={brl(r.lanceEmbutido)} />
                <Mini label="Livre (recurso próprio)" value={brl(r.lanceLivre)} />
                <Mini label="Lance total" value={pct(r.lancePct, 2)} strong />
              </div>
              <Row label="Saldo devedor na contemplação" value={brl(r.saldoNaContemplacao)} />
              <Row label="Saldo após o lance" value={brl(r.saldoPosLance)} />
              <Row label="Crédito recebido" value={brl(r.creditoLiquido)} strong />
              {r.lanceTotal > 0 && r.restantes > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-900/30">
                    <p className="text-xs text-muted">Opção 1 · reduzir parcela</p>
                    <p className="mt-1 text-lg font-bold">{brl(r.parcelaReduzida)}</p>
                    <p className="text-xs text-muted">pelos {r.restantes} meses restantes</p>
                  </div>
                  <div className="rounded-xl border border-accent-200 bg-accent-50/60 p-3 dark:border-accent-800 dark:bg-accent-900/20">
                    <p className="text-xs text-muted">Opção 2 · reduzir prazo</p>
                    <p className="mt-1 text-lg font-bold">{r.prazoReduzido} meses</p>
                    <p className="text-xs text-muted">{r.mesesEconomizados} parcela(s) a menos</p>
                  </div>
                </div>
              ) : (
                <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Informe um lance embutido ou livre para ver o efeito na parcela ou no prazo após a contemplação.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Consórcio × financiamento" icon={<Scale className="h-4 w-4" />} description={`Mesmo valor líquido (${brl(r.creditoLiquido)}) em ${r.prazo} meses, juros de ${pct(r.juros * 100, 3)} a.m.`} />
          <CardBody>
            <div className="grid gap-6 lg:grid-cols-[1fr_280px] lg:items-center">
              <div className="space-y-5">
                <CompareBar icon={<Landmark className="h-4 w-4" />} label="Consórcio" parcela={r.parcela} total={r.desembolsoConsorcio} encargos={r.desembolsoConsorcio - r.creditoLiquido} width={(r.desembolsoConsorcio / maxTotal) * 100} cls="from-brand-500 to-brand-700" />
                <CompareBar icon={<Banknote className="h-4 w-4" />} label="Financiamento" parcela={r.pmt} total={r.totalFinanciamento} encargos={r.jurosFinanciamento} width={(r.totalFinanciamento / maxTotal) * 100} cls="from-slate-400 to-slate-600" />
              </div>
              <div className={cn("rounded-2xl p-5 text-center", r.economia >= 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200")}>
                <TrendingDown className="mx-auto h-6 w-6" />
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider">{r.economia >= 0 ? "Economia com o consórcio" : "Diferença a favor do financiamento"}</p>
                <p className="mt-1 text-3xl font-bold tracking-tight">{brl(Math.abs(r.economia))}</p>
                {r.totalFinanciamento > 0 && <p className="mt-1 text-xs opacity-80">{pct((Math.abs(r.economia) / r.totalFinanciamento) * 100, 1)} do total financiado</p>}
              </div>
            </div>
            <p className="mt-5 text-[11px] leading-relaxed text-muted">
              Simulação ilustrativa, sem valor de contrato. Valores de parcela sujeitos a reajuste anual do crédito conforme índice do grupo e às regras da administradora.
              Contemplação por sorteio ou lance não é garantida em data específica. O lance embutido utiliza parte do próprio crédito.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  range,
  digits = 2,
  help,
  chips,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  range?: { min: number; max: number; step: number };
  digits?: number;
  help?: string;
  chips?: number[];
}) {
  const n = parseBR(value);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        {prefix && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">{prefix}</span>}
        <input
          value={value}
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onChange(fmtNum(n, digits))}
          className={cn("input tabular-nums", prefix && "pl-10", suffix && (suffix.length > 3 ? "pr-24" : "pr-12"))}
          aria-label={label}
        />
        {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
      </div>
      {range && (
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={clamp(n, range.min, range.max)}
          onChange={(e) => onChange(fmtNum(Number(e.target.value), digits))}
          className="mt-2 w-full accent-accent-500"
          aria-label={`${label} (controle deslizante)`}
        />
      )}
      {chips && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(String(c))}
              className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium transition", n === c ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-200" : "border-line text-muted hover:text-fg")}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {help && <p className="mt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={120} className="input" aria-label={label} />
    </div>
  );
}

function Hero({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl px-3.5 py-2.5 ring-1 ring-inset", highlight ? "bg-accent-500/25 ring-accent-300/40" : "bg-white/10 ring-white/15")}>
      <p className="text-[11px] text-white/70">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cn("tabular-nums", strong ? "font-bold text-accent-600" : "font-semibold")}>{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5 last:border-0">
      <span className="text-muted">{label}</span>
      <span className={cn("tabular-nums", strong ? "font-bold" : "font-medium")}>{value}</span>
    </div>
  );
}

function PrintItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line p-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function CompareBar({ icon, label, parcela, total, encargos, width, cls }: { icon: React.ReactNode; label: string; parcela: number; total: number; encargos: number; width: number; cls: string }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          {icon} {label}
        </span>
        <span className="text-xs text-muted">
          Parcela <b className="text-fg">{brl(parcela)}</b> · encargos {brl(encargos)}
        </span>
      </div>
      <div className="h-9 w-full overflow-hidden rounded-xl bg-surface-2">
        <div className={cn("flex h-full items-center justify-end rounded-xl bg-gradient-to-r px-3 text-xs font-bold text-white transition-all duration-500", cls)} style={{ width: `${Math.max(width, 18)}%` }}>
          {brl(total)}
        </div>
      </div>
    </div>
  );
}
