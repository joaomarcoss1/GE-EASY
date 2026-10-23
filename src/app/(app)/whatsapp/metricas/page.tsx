import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock, MessageCircle, PieChart, Timer, UserPlus, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { WA_RESULTADOS, toMap } from "@/lib/constants";
import { brl, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Métricas de atendimento" };

type Metricas = {
  conversas: number; primeira_resposta_min: number | null; resolucao_h: number | null; sla_estourado: number;
  por_atendente: { atendente_id: string | null; total: number; resolvidas: number; primeira_resposta_min: number | null }[];
  resultados: Record<string, number>; leads_whatsapp: { total: number; convertidos: number }; mensagens_modelo: Record<string, number>; custo_estimado: number;
};

/** Tempo de primeira resposta, resolução, volume por atendente, SLA, conversão de leads e custo estimado das mensagens pagas. */
export default async function MetricasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  if (!can(profile, "whatsapp.supervisionar") && !can(profile, "relatorios.view")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.fim ?? "") ? sp.fim! : todayISO();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(sp.inicio ?? "") ? sp.inicio! : `${fim.slice(0, 7)}-01`;
  const supabase = await createClient();
  const [{ data, error }, profiles] = await Promise.all([supabase.rpc("wa_metricas", { p_inicio: inicio, p_fim: fim }), getProfileMap()]);
  const resultados = toMap(WA_RESULTADOS);
  if (error || !data) return <EmptyState title="Métricas indisponíveis" description="Você precisa da permissão de supervisão do WhatsApp." />;
  const m = data as Metricas;
  return (
    <>
      <PageHeader eyebrow="Atendimento" title="Métricas de atendimento" description="WhatsApp: rapidez, resolução, carga por atendente e retorno comercial." />
      <form className="mb-6 flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">De<input className="input" type="date" name="inicio" defaultValue={inicio} /></label>
        <label className="grid gap-1">Até<input className="input" type="date" name="fim" defaultValue={fim} /></label>
        <button className="rounded-xl border border-line px-4 py-2 font-semibold">Filtrar</button>
      </form>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Conversas" value={m.conversas} icon={<MessageCircle className="h-5 w-5" />} />
        <StatCard label="1ª resposta (média)" value={m.primeira_resposta_min != null ? `${m.primeira_resposta_min} min` : "—"} icon={<Timer className="h-5 w-5" />} tone="accent" hint={`${m.sla_estourado} fora do prazo`} />
        <StatCard label="Resolução (média)" value={m.resolucao_h != null ? `${m.resolucao_h} h` : "—"} icon={<Clock className="h-5 w-5" />} tone="green" />
        <StatCard label="Leads do WhatsApp" value={m.leads_whatsapp.total} icon={<UserPlus className="h-5 w-5" />} tone="amber" hint={`${m.leads_whatsapp.convertidos} convertido(s)`} />
        <StatCard label="Custo estimado (modelos)" value={brl(m.custo_estimado)} icon={<Wallet className="h-5 w-5" />} tone="brand" hint={Object.entries(m.mensagens_modelo).map(([k, v]) => `${v} ${k}`).join(" · ") || "Nenhuma mensagem paga"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Por atendente" icon={<PieChart className="h-4 w-4" />} />
          {!m.por_atendente.length ? <EmptyState title="Sem conversas no período" /> : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>Atendente</th><th className="text-right">Conversas</th><th className="text-right">Resolvidas</th><th className="text-right">1ª resposta (min)</th></tr></thead>
              <tbody>{m.por_atendente.map((a, i) => (
                <tr key={i}><td>{a.atendente_id ? profiles.get(a.atendente_id)?.full_name ?? "—" : "Fila"}</td><td className="text-right">{a.total}</td><td className="text-right">{a.resolvidas}</td><td className="text-right">{a.primeira_resposta_min ?? "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Resultado dos atendimentos" />
          <ul className="divide-y divide-line text-sm">
            {Object.entries(m.resultados).map(([k, v]) => <li key={k} className="flex justify-between px-5 py-2.5"><span>{resultados[k]?.label ?? "Em aberto"}</span><span className="font-semibold">{v}</span></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
