"use client";
import { useId, useMemo, useState } from "react";
import { CalendarCheck2, CalendarX2, Info, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { PRAZO_CONTAGEM } from "@/lib/constants";
import { calcularPrazo } from "@/lib/juridico/prazos";
import { Button } from "@/components/ui/button";
import { agruparPulados, addDaysYmd, brDate, brDateWeekday, diffDays, isValidYmd, parseFeriados } from "./utils";

export interface CalculoResultado {
  data_publicacao: string;
  dias: number;
  contagem: "uteis" | "corridos";
  feriados_extras: string;
  data_fim: string;
}

const todayLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * Calculadora de prazos processuais (CPC arts. 219, 220 e 224).
 * Mostra o vencimento e os dias não contados, com o motivo de cada um.
 */
export function Calculadora({
  initial,
  onUse,
  useLabel = "Criar prazo com esta data",
  compact = false,
}: {
  initial?: Partial<{ data_publicacao: string | null; dias: number | string | null; contagem: string | null; feriados_extras: string | null }>;
  onUse?: (r: CalculoResultado) => void;
  useLabel?: string;
  compact?: boolean;
}) {
  const uid = useId();
  const [pub, setPub] = useState(() => (initial?.data_publicacao && isValidYmd(initial.data_publicacao) ? initial.data_publicacao : todayLocal()));
  const [dias, setDias] = useState(() => (initial?.dias !== undefined && initial?.dias !== null && initial.dias !== "" ? String(initial.dias) : "15"));
  const [contagem, setContagem] = useState<"uteis" | "corridos">(initial?.contagem === "corridos" ? "corridos" : "uteis");
  const [dobro, setDobro] = useState(false);
  const [feriados, setFeriados] = useState(initial?.feriados_extras ?? "");

  const parsedFeriados = useMemo(() => parseFeriados(feriados), [feriados]);
  const nDias = Number(dias);
  const diasValidos = dias.trim() !== "" && Number.isInteger(nDias) && nDias >= 0 && nDias <= 365;
  const diasEfetivos = diasValidos ? Math.min(365, dobro ? nDias * 2 : nDias) : 0;

  const result = useMemo(() => {
    if (!isValidYmd(pub) || !diasValidos) return null;
    const r = calcularPrazo(pub, diasEfetivos, contagem, parsedFeriados.datas);
    // Início da contagem: 1º dia contado após a publicação (CPC art. 224 §3º)
    const skipped = new Set(r.pulados.map((p) => p.data));
    let inicio = addDaysYmd(pub, 1);
    for (let i = 0; i < 400 && skipped.has(inicio); i++) inicio = addDaysYmd(inicio, 1);
    return { ...r, inicio, grupos: agruparPulados(r.pulados, parsedFeriados.datas) };
  }, [pub, diasValidos, diasEfetivos, contagem, parsedFeriados.datas]);

  const today = todayLocal();
  const restante = result ? diffDays(result.dataFim, today) : null;

  return (
    <div className="space-y-4">
      <div className={cn("grid grid-cols-2 gap-3", !compact && "sm:grid-cols-6")}>
        <div className={cn("col-span-2", !compact && "sm:col-span-3")}>
          <label htmlFor={`${uid}-pub`} className="label">
            Data da publicação
          </label>
          <input id={`${uid}-pub`} type="date" value={pub} onChange={(e) => setPub(e.target.value)} className="input" />
        </div>
        <div className={cn(!compact && "sm:col-span-1")}>
          <label htmlFor={`${uid}-dias`} className="label">
            Dias
          </label>
          <input
            id={`${uid}-dias`}
            type="number"
            min={0}
            max={365}
            step={1}
            inputMode="numeric"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className="input"
            aria-invalid={!diasValidos || undefined}
          />
        </div>
        <div className={cn(!compact && "sm:col-span-2")}>
          <label htmlFor={`${uid}-cont`} className="label">
            Contagem
          </label>
          <select id={`${uid}-cont`} value={contagem} onChange={(e) => setContagem(e.target.value === "corridos" ? "corridos" : "uteis")} className="input">
            {PRAZO_CONTAGEM.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === "uteis" ? "Dias úteis" : o.label}
              </option>
            ))}
          </select>
        </div>
        <div className={cn("col-span-2", !compact && "sm:col-span-6")}>
          <label htmlFor={`${uid}-fer`} className="label">
            Feriados locais extras
          </label>
          <input id={`${uid}-fer`} value={feriados} onChange={(e) => setFeriados(e.target.value)} placeholder="dd/mm/aaaa, dd/mm/aaaa" className="input" />
          {parsedFeriados.invalidos.length > 0 ? (
            <p className="mt-1 text-xs font-medium text-red-600">Ignorados (formato inválido): {parsedFeriados.invalidos.slice(0, 4).join(", ")}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">Estaduais, municipais ou suspensões do tribunal. Separe por vírgula.</p>
          )}
        </div>
        <label className={cn("col-span-2 flex cursor-pointer items-center gap-2 text-sm", !compact && "sm:col-span-6")}>
          <input type="checkbox" checked={dobro} onChange={(e) => setDobro(e.target.checked)} className="h-4 w-4 rounded accent-brand-700" />
          <span>
            Prazo em dobro <span className="text-muted">(Fazenda Pública, MP, Defensoria, litisconsortes com procuradores distintos)</span>
          </span>
        </label>
      </div>

      {!diasValidos ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">Informe um número inteiro de dias entre 0 e 365.</p>
      ) : !result ? (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">Informe a data da publicação.</p>
      ) : (
        <div className="space-y-3">
          <div
            className={cn(
              "rounded-2xl border px-4 py-3.5",
              restante !== null && restante < 0
                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                : restante !== null && restante <= 2
                  ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                  : "border-brand-200 bg-brand-50/70 dark:border-brand-800 dark:bg-brand-900/30",
            )}
            aria-live="polite"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Vencimento</p>
            <p className="mt-0.5 flex items-center gap-2 text-xl font-bold tracking-tight">
              <CalendarCheck2 className="h-5 w-5 text-brand-600 dark:text-brand-300" />
              {brDateWeekday(result.dataFim)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {diasEfetivos} dia{diasEfetivos === 1 ? "" : "s"} {contagem === "uteis" ? "úteis" : "corridos"}
              {dobro && " (em dobro)"} · início da contagem em {brDate(result.inicio)} · {result.diasCorridos} dias corridos após a publicação
              {restante !== null && (restante < 0 ? ` · venceu há ${-restante} dia(s)` : restante === 0 ? " · vence hoje" : ` · faltam ${restante} dia(s)`)}
            </p>
          </div>

          {result.grupos.length > 0 ? (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <CalendarX2 className="h-3.5 w-3.5" /> Dias não contados ({result.pulados.length})
              </p>
              <ul className={cn("divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm", compact ? "max-h-40" : "max-h-56")}>
                {result.grupos.map((g) => (
                  <li key={g.de} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="tabular-nums">{g.de === g.ate ? brDateWeekday(g.de) : `${brDate(g.de)} a ${brDate(g.ate)}`}</span>
                    <span className="truncate text-right text-xs text-muted">
                      {g.motivo}
                      {g.dias > 1 && ` · ${g.dias} dias`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted">Nenhum dia pulado: não há fins de semana, feriados ou recesso no período.</p>
          )}

          <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            Exclui o dia da publicação e inclui o do vencimento (art. 224); suspende de 20/12 a 20/01 (art. 220); prorroga para o 1º dia útil seguinte. Confira
            sempre os feriados do tribunal.
          </p>

          {onUse && (
            <Button
              type="button"
              variant="accent"
              className="w-full"
              onClick={() =>
                onUse({ data_publicacao: pub, dias: diasEfetivos, contagem, feriados_extras: parsedFeriados.datas.map((d) => brDate(d)).join(", "), data_fim: result.dataFim })
              }
            >
              <Plus className="h-4 w-4" /> {useLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
