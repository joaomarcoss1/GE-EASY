import { META_INDICADORES, META_PERIODICIDADES } from "@/lib/constants";
import { num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Progress } from "@/components/ui/progress";
import { Badge, optionLabel } from "@/components/ui/badge";

export interface MetaLinha {
  meta_id: string;
  nome: string;
  indicador: string;
  periodicidade: "diaria" | "mensal" | "anual";
  alvo: "empresa" | "assessor" | "categoria" | "usuario";
  usuario_id?: string | null;
  categoria: string | null;
  valor: number;
  assessor_id: string | null;
  assessor_nome: string | null;
  assessor_tem_usuario: boolean | null;
  inicio: string;
  fim: string;
  realizado: number;
}

/** % do período já decorrido (ritmo esperado). Diária: 100 (vale o dia todo). */
export function ritmoEsperado(periodicidade: MetaLinha["periodicidade"], inicio: string, fim: string, hoje: string): number {
  if (periodicidade === "diaria") return 100;
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  if (hoje > fim) return 100;
  if (hoje < inicio) return 0;
  return Math.min(100, ((d(hoje) - d(inicio)) / 86_400_000 + 1) / ((d(fim) - d(inicio)) / 86_400_000 + 1) * 100);
}

export function rotuloMeta(m: MetaLinha) {
  return m.alvo === "categoria" && m.assessor_nome ? `${m.assessor_nome} · ${m.nome.replace(/\s*\(cada\)\s*/, "")}` : m.nome;
}

/** Linha de meta com barra de progresso e situação em relação ao ritmo do período. */
export function MetaProgresso({ m, hoje, compacto = false }: { m: MetaLinha; hoje: string; compacto?: boolean }) {
  const perc = m.valor ? (m.realizado / m.valor) * 100 : 0;
  const ritmo = ritmoEsperado(m.periodicidade, m.inicio, m.fim, hoje);
  const batida = perc >= 100;
  const noRitmo = perc >= ritmo;
  const semUsuario = m.indicador === "ligacoes" && m.assessor_id && !m.assessor_tem_usuario;
  return (
    <div className={cn(compacto ? "py-2.5" : "py-3")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 font-medium">
          {rotuloMeta(m)}
          <span className="ml-1.5 text-xs font-normal text-muted">{optionLabel(META_PERIODICIDADES, m.periodicidade).toLowerCase()} · {optionLabel(META_INDICADORES, m.indicador).toLowerCase()}</span>
        </span>
        <span className="tabular-nums"><b className="text-base">{num(m.realizado)}</b> <span className="text-muted">de {num(m.valor)}</span> <span className={cn("ml-1 text-xs font-semibold", batida ? "text-emerald-600 dark:text-emerald-400" : noRitmo ? "text-brand-600 dark:text-brand-300" : "text-accent-600")}>{Math.round(perc)}%</span></span>
      </div>
      <Progress value={perc} tone={batida ? "green" : noRitmo ? "brand" : "accent"} className="mt-1.5" />
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>{batida ? "Meta batida" : noRitmo ? "No ritmo" : `Abaixo do ritmo (esperado ${Math.round(ritmo)}%) · faltam ${num(Math.max(0, m.valor - m.realizado))}`}</span>
        {semUsuario && <Badge tone="amber">ligue o assessor a um usuário para contar as ligações</Badge>}
      </div>
    </div>
  );
}
