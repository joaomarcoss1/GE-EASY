import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ArrowRightLeft, BadgePercent, MapPin, UserPlus, Users } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CADASTRO_STATUS } from "@/lib/constants";
import { brl, date, dateTime, daysUntil, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Minha carteira" };

/** Entrada do consultor: carteira, documentação pendente com contagem regressiva, visitas e comissão prevista. */
export default async function ConsultorPage() {
  const { profile, userId } = await requireArea("consultor");
  const supabase = await createClient();
  const hoje = todayISO();
  const [{ data: pendentes }, { count: carteira }, { count: novosMes }, { data: transferidos }, { count: visitasHoje }, { data: comissoes }] = await Promise.all([
    supabase.from("clientes").select("id, nome, cidade, prazo_documentacao, prorrogacoes").eq("consultor_id", userId).eq("carteira", "consultor").eq("status_cadastro", "pendente_documentacao").order("prazo_documentacao", { ascending: true }).limit(50),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("consultor_id", userId).eq("carteira", "consultor"),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("consultor_id", userId).gte("created_at", `${hoje.slice(0, 7)}-01T00:00:00-03:00`),
    supabase.rpc("meus_clientes_transferidos", { p_limite: 10 }),
    supabase.from("visitas").select("id", { count: "exact", head: true }).eq("consultor_id", userId).gte("checkin_em", `${hoje}T00:00:00-03:00`),
    can(profile, "comissoes.view") ? supabase.from("comissoes").select("valor_consultor").eq("consultor_id", userId).eq("status", "prevista") : Promise.resolve({ data: [] as { valor_consultor: number }[] }),
  ]);
  const lista = pendentes ?? [];
  const criticos = lista.filter((c) => c.prazo_documentacao && daysUntil(c.prazo_documentacao) <= 7).length;
  const previsto = (comissoes ?? []).reduce((a, c) => a + Number(c.valor_consultor), 0);
  const trans = (transferidos ?? []) as { cliente_nome: string; motivo: string; transferido_em: string }[];

  return (
    <>
      <PageHeader
        eyebrow="Área do consultor"
        title={`Olá, ${profile.full_name.split(" ")[0] || "consultor"}`}
        description="Sua carteira, a documentação pendente e o que fazer hoje."
        actions={
          <>
            {can(profile, "visitas.checkin") && <LinkButton href="/visitas" variant="secondary"><MapPin className="h-4 w-4" />Check-in</LinkButton>}
            {can(profile, "clientes.write") && <LinkButton href="/clientes?novo=1" variant="accent"><UserPlus className="h-4 w-4" />Pré-cadastro</LinkButton>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Clientes na carteira" value={carteira ?? 0} icon={<Users className="h-5 w-5" />} hint={`${novosMes ?? 0} novo(s) no mês`} />
        <StatCard label="Documentação pendente" value={lista.length} icon={<AlarmClock className="h-5 w-5" />} tone={criticos ? "amber" : "brand"} hint={criticos ? `${criticos} vencendo em até 7 dias` : "Nenhum prazo crítico"} />
        <StatCard label="Visitas hoje" value={visitasHoje ?? 0} icon={<MapPin className="h-5 w-5" />} tone="green" />
        {can(profile, "comissoes.view") && <StatCard label="Comissão prevista" value={brl(previsto)} icon={<BadgePercent className="h-5 w-5" />} tone="accent" />}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Documentação pendente" description="Após o prazo, o cliente vai para a base administrativa e sai da sua carteira." icon={<AlarmClock className="h-4 w-4" />} />
          {lista.length === 0 ? (
            <EmptyState title="Nenhuma pendência" description="Clientes com documentação a coletar aparecem aqui com a contagem regressiva." />
          ) : (
            <ul className="divide-y divide-line">
              {lista.map((c) => {
                const d = c.prazo_documentacao ? daysUntil(c.prazo_documentacao) : null;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <Link href={`/clientes/${c.id}`} className="block truncate font-medium hover:text-brand-600">{c.nome}</Link>
                      <p className="text-xs text-muted">{c.cidade ?? "—"} · até {date(c.prazo_documentacao)}{c.prorrogacoes ? ` · prorrogado ${c.prorrogacoes}x` : ""}</p>
                    </div>
                    <span className={cn("rounded-lg px-2.5 py-1 text-xs font-bold", d === null ? "bg-surface-2" : d <= 3 ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200" : d <= 7 ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100" : "bg-surface-2 text-muted")}>
                      {d === null ? "—" : d > 0 ? `${d} dia(s)` : "hoje"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Saíram da sua carteira" icon={<ArrowRightLeft className="h-4 w-4" />} />
          {trans.length === 0 ? (
            <EmptyState title="Nenhuma transferência" />
          ) : (
            <ul className="divide-y divide-line text-sm">
              {trans.map((t, i) => (
                <li key={i} className="px-5 py-3">
                  <p className="font-medium">{t.cliente_nome}</p>
                  <p className="text-xs text-muted">{t.motivo === "regra_prazo_documentacao" ? "Transferido por falta de documentação" : "Redistribuído pela gestão"} · {dateTime(t.transferido_em)}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-5 py-3 text-xs text-muted">
            <StatusBadge options={CADASTRO_STATUS} value="transferido_administrativo" /> clientes transferidos ficam com o administrativo; você vê só este registro.
          </div>
        </Card>
      </div>
    </>
  );
}
