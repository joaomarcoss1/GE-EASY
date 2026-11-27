import Link from "next/link";
import { AlarmClock, BarChart3, ClipboardList, FolderSearch, Layers, ShieldAlert, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CASO_STATUS } from "@/lib/constants";
import { date, num, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";

interface Setor { status: string; fila: number; entraram: number; sairam: number; parados15: number; dias_medio: number | null }
interface Painel {
  total: number;
  por_status: Record<string, number>;
  pendencias: Record<string, number>;
  hab_mes: number;
  setores: Setor[];
  por_tipo: { tipo: string; n: number }[];
  exigencias: { vencidas: number; tres_dias: number; prorrogadas: number; lista: { caso_id: string; cliente_id: string; nome: string; tipo: string; prazo: string | null; prorrogada: boolean }[] };
  atencao: { hab_sem_protocolo: number; sem_assinatura: number; sem_assessor: number };
}

export const COR_STATUS: Record<string, string> = {
  em_analise: "bg-sky-500", pendencia: "bg-amber-500", exigencia: "bg-red-500", habilitacao: "bg-accent-500", habilitado: "bg-emerald-500",
  deferido: "bg-green-700", indeferido: "bg-rose-600", aguardando_idade: "bg-brand-500", judicializado: "bg-violet-500",
  arquivo_morto: "bg-slate-400", outros: "bg-slate-300",
};
const SETOR: Record<string, { nome: string; resp: string; href: string }> = {
  em_analise: { nome: "Análise", resp: "Tati", href: "/administrativo/processos?status=em_analise" },
  pendencia: { nome: "Pendências", resp: "Vânia", href: "/administrativo/pendencias" },
  exigencia: { nome: "Exigências", resp: "Vitória", href: "/administrativo/exigencias" },
  habilitacao: { nome: "Habilitação", resp: "Aline", href: "/administrativo/encaminhados" },
};
const linkCls = "text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300";
const Ponto = ({ cor, rotulo, n, href }: { cor: string; rotulo: string; n: number; href?: string }) => {
  const corpo = (<><span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", n ? cor : "bg-slate-300")} /><span className="flex-1">{rotulo}</span><b className="tabular-nums">{num(n)}</b></>);
  return <li>{href ? <Link href={href} className="flex items-center gap-2.5 py-2.5 text-sm hover:text-brand-600">{corpo}</Link> : <div className="flex items-center gap-2.5 py-2.5 text-sm">{corpo}</div>}</li>;
};

/** Painel administrativo, parte 1: processos dos clientes (banco: `painel_processos_adm`, respeita o RLS). */
export async function PainelProcessos({ docsConferir }: { docsConferir: number }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("painel_processos_adm");
  if (error || !data) {
    console.error("[painel-adm]", error?.code, error?.message);
    return <Card className="p-5 text-sm text-muted">Não foi possível carregar os números dos processos agora.</Card>;
  }
  const p = data as Painel;
  const st = (s: string) => p.por_status[s] ?? 0;
  const ativos = p.total - st("arquivo_morto") - st("indeferido");
  const hoje = todayISO();
  const maxTipo = Math.max(1, ...p.por_tipo.map((t) => t.n));
  const tipos = p.por_tipo.length > 6 ? [...p.por_tipo.slice(0, 5), { tipo: "Outros", n: p.por_tipo.slice(5).reduce((a, t) => a + t.n, 0) }] : p.por_tipo;
  const pend = Object.entries(p.pendencias).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${num(n)} ${k === "assinatura" ? "assinatura" : k === "documentacao" ? "documentação" : k}`).join(" · ");

  return (
    <>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Processos ativos" value={num(ativos)} icon={<FolderSearch className="h-5 w-5" />} hint={`${num(p.total)} no total · ${num(st("arquivo_morto"))} no arquivo morto`} />
        <StatCard label="Em análise" value={num(st("em_analise"))} icon={<Layers className="h-5 w-5" />} tone="brand" hint="Fila da análise" />
        <StatCard label="Pendência" value={num(st("pendencia"))} icon={<ClipboardList className="h-5 w-5" />} tone="amber" hint={pend || "Nenhuma"} />
        <StatCard label="Exigência" value={num(st("exigencia"))} icon={<AlarmClock className="h-5 w-5" />} tone={p.exigencias.vencidas ? "amber" : "brand"} hint={p.exigencias.vencidas ? `${num(p.exigencias.vencidas)} vencida(s)` : "Nenhuma vencida"} />
        <StatCard label="Aguardando habilitação" value={num(st("habilitacao"))} icon={<UserCheck className="h-5 w-5" />} tone="accent" hint="Fila da habilitação" />
        <StatCard label="Habilitados" value={num(st("habilitado"))} icon={<UserCheck className="h-5 w-5" />} tone="green" hint={`${num(p.hab_mes)} no mês`} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_1.25fr]">
        <Card>
          <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Divisão por status" description={`${num(p.total)} processos`} action={<Link href="/administrativo/processos" className={linkCls}>Abrir lista</Link>} />
          <div className="p-5">
            <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {CASO_STATUS.map((s) => (st(s.value) ? <div key={s.value} className={COR_STATUS[s.value]} style={{ width: `${(st(s.value) / Math.max(1, p.total)) * 100}%` }} title={`${s.label}: ${st(s.value)}`} /> : null))}
            </div>
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {CASO_STATUS.filter((s) => st(s.value) || ["em_analise", "pendencia", "exigencia", "habilitacao", "habilitado"].includes(s.value)).map((s) => (
                <li key={s.value}>
                  <Link href={`/administrativo/processos?status=${s.value}`} className="group flex items-center gap-2 text-sm">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", COR_STATUS[s.value])} />
                    <span className="flex-1 group-hover:text-brand-600">{s.label}</span>
                    <b className="tabular-nums">{num(st(s.value))}</b>
                    <span className="w-10 text-right text-xs tabular-nums text-muted">{p.total ? `${Math.round((st(s.value) / p.total) * 100)}%` : "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Layers className="h-4 w-4" />} title="Fila de cada setor" description="Entradas e saídas no mês e o que está parado" />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Setor</th><th>Responsável</th><th className="text-right">Na fila</th><th className="text-right">Entraram no mês</th><th className="text-right">Saíram no mês</th><th className="text-right">Parados +15 dias</th><th className="text-right">Tempo médio</th></tr></thead>
              <tbody>
                {p.setores.map((s) => {
                  const x = SETOR[s.status];
                  return (
                    <tr key={s.status}>
                      <td><Link href={x.href} className="font-semibold hover:text-brand-600">{x.nome}</Link></td>
                      <td className="text-sm">{x.resp}</td>
                      <td className="text-right font-bold tabular-nums">{num(s.fila)}</td>
                      <td className={cn("text-right tabular-nums", !s.entraram && "text-muted")}>{num(s.entraram)}</td>
                      <td className={cn("text-right tabular-nums", !s.sairam && "text-muted")}>{num(s.sairam)}</td>
                      <td className={cn("text-right tabular-nums", s.parados15 ? "font-bold text-amber-700 dark:text-amber-300" : "text-muted")}>{num(s.parados15)}</td>
                      <td className={cn("text-right tabular-nums", s.dias_medio == null && "text-muted")}>{s.dias_medio == null ? "—" : `${num(s.dias_medio)} dia(s)`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Por benefício" description="Processos ativos" />
          <ul className="space-y-2 p-5">
            {tipos.map((t) => (
              <li key={t.tipo} className="flex items-center gap-3 text-sm">
                <span className="w-36 shrink-0 truncate" title={t.tipo}>{t.tipo}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-brand-700 dark:bg-brand-400" style={{ width: `${(t.n / maxTipo) * 100}%` }} /></span>
                <b className="w-12 text-right tabular-nums">{num(t.n)}</b>
              </li>
            ))}
            {tipos.length === 0 && <li className="text-sm text-muted">Nenhum processo ativo.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader icon={<AlarmClock className="h-4 w-4" />} title="Prazos de exigência" action={<Link href="/administrativo/exigencias" className={linkCls}>Exigências (fichas)</Link>} />
          <ul className="divide-y divide-line px-5">
            <Ponto cor="bg-red-600" rotulo="Vencidas" n={p.exigencias.vencidas} />
            <Ponto cor="bg-amber-500" rotulo="Vencem em até 3 dias" n={p.exigencias.tres_dias} />
            <Ponto cor="bg-slate-400" rotulo="Prorrogadas (+7 dias)" n={p.exigencias.prorrogadas} />
          </ul>
          {p.exigencias.lista.length === 0 ? (
            <p className="m-5 mt-2 rounded-xl border border-dashed border-line p-4 text-center text-sm text-muted">Nenhum processo em exigência agora.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {p.exigencias.lista.map((e) => (
                <li key={e.caso_id} className="flex items-center justify-between gap-2 px-5 py-2">
                  <span className="min-w-0"><Link href={`/clientes/${e.cliente_id}`} className="block truncate text-sm font-medium hover:text-brand-600">{e.nome}</Link><span className="text-xs text-muted">{e.tipo}</span></span>
                  {e.prazo && <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold", e.prazo < hoje ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100")}>{date(e.prazo)}{e.prorrogada ? " · prorr." : ""}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader icon={<ShieldAlert className="h-4 w-4" />} title="Pontos de atenção" action={<Link href="/administrativo/inconsistencias" className={linkCls}>Inconsistências</Link>} />
          <ul className="divide-y divide-line px-5">
            <Ponto cor="bg-red-600" rotulo="Habilitados sem protocolo do INSS" n={p.atencao.hab_sem_protocolo} href="/administrativo/processos?status=habilitado" />
            <Ponto cor="bg-amber-500" rotulo="Sem assinatura (contrato/procuração)" n={p.atencao.sem_assinatura} />
            <Ponto cor="bg-amber-500" rotulo="Processos sem assessor" n={p.atencao.sem_assessor} />
            <Ponto cor="bg-slate-400" rotulo="Documentos aguardando conferência" n={docsConferir} href="/administrativo/documentacao" />
          </ul>
        </Card>
      </div>
    </>
  );
}
