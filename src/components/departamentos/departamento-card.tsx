import Link from "next/link";
import { AlarmClock, Gavel, ListChecks, Scale } from "lucide-react";
import { cn } from "@/lib/cn";
import { num } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { depSigla, depTone } from "./tone";

export interface DepCardData {
  id: string;
  nome: string;
  sigla: string | null;
  descricao: string | null;
  cor: string;
  ativo: boolean;
  meu: boolean;
  responsavel: { nome: string; avatar: string | null } | null;
  membros: { id: string; nome: string; avatar: string | null }[];
  processos: number;
  prazos: number;
  vencidos: number;
  audiencias: number;
  demandas: number;
}

function Kpi({ icon, label, value, children, alert }: { icon: React.ReactNode; label: string; value: number; children?: React.ReactNode; alert?: boolean }) {
  return (
    <div className={cn("min-w-0 px-3 py-3", alert && "bg-red-50/70 dark:bg-red-950/30")}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums tracking-tight">{num(value)}</p>
      {children}
    </div>
  );
}

export function DepartamentoCard({ d }: { d: DepCardData }) {
  const tone = depTone(d.cor);
  const shown = d.membros.slice(0, 5);
  const extra = d.membros.length - shown.length;
  return (
    <Link
      href={`/departamentos/${d.id}`}
      className={cn(
        "card group relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-pop focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        !d.ativo && "opacity-70",
      )}
    >
      <div className={cn("h-1.5 w-full", tone.bar)} />
      <div className={cn("bg-gradient-to-b to-transparent px-5 pb-4 pt-4", tone.soft)}>
        <div className="flex items-start gap-3">
          <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[11px] font-bold tracking-wide shadow-sm", tone.chip)}>{depSigla(d)}</span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold group-hover:text-brand-700 dark:group-hover:text-brand-200">{d.nome}</h3>
            <p className="mt-0.5 line-clamp-2 min-h-[2rem] text-xs text-muted">{d.descricao || "Sem descrição cadastrada."}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {d.meu && <Badge tone="brand">Meu</Badge>}
            {!d.ativo && <Badge tone="slate">Inativo</Badge>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 divide-x divide-line border-y border-line">
        <Kpi icon={<Scale className="h-3.5 w-3.5" />} label="Processos" value={d.processos} />
        <Kpi icon={<AlarmClock className="h-3.5 w-3.5" />} label="Prazos" value={d.prazos} alert={d.vencidos > 0}>
          {d.vencidos > 0 ? (
            <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">{num(d.vencidos)} vencido(s)</p>
          ) : (
            <p className="text-[11px] text-muted">em dia</p>
          )}
        </Kpi>
        <Kpi icon={<Gavel className="h-3.5 w-3.5" />} label="Audiências 7d" value={d.audiencias} />
        <Kpi icon={<ListChecks className="h-3.5 w-3.5" />} label="Demandas" value={d.demandas} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-3 px-5 py-3">
        {d.responsavel ? (
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={d.responsavel.nome} src={d.responsavel.avatar} size={28} />
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Responsável</p>
              <p className="truncate text-xs font-medium">{d.responsavel.nome}</p>
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted">Sem responsável definido</span>
        )}
        <div className="flex shrink-0 items-center" aria-label={`${d.membros.length} membro(s)`}>
          <div className="flex -space-x-2">
            {shown.map((m) => (
              <span key={m.id} title={m.nome} className="rounded-full ring-2 ring-surface">
                <Avatar name={m.nome} src={m.avatar} size={26} />
              </span>
            ))}
          </div>
          {extra > 0 && <span className="ml-1.5 text-xs font-semibold text-muted">+{extra}</span>}
          {d.membros.length === 0 && <span className="text-xs text-muted">sem membros</span>}
        </div>
      </div>
    </Link>
  );
}
