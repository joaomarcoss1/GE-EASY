import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FolderPlus, MapPin, Route, UserPlus } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { TIPOS_ACAO } from "@/lib/constants";
import { num, todayISO } from "@/lib/format";
import { addDays, isISODate } from "@/components/dashboard/periods";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Resumo diário dos assessores" };

interface Linha {
  id: string;
  nome: string;
  acordo: boolean;
  tem_usuario: boolean;
  processos: number;
  por_tipo: Record<string, number>;
  clientes: number;
  rotas: number;
  rotas_concluidas: number;
  paradas: number;
  visitadas: number;
  nao_realizadas: number;
  km_planejado: number;
}

const fmtDia = (iso: string) => {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};

/** Resumo do dia por assessor: processos novos adquiridos e rotas (paradas visitadas). */
export default async function ResumoDiarioPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const { profile } = await requirePermission("clientes.view");
  const { data: dataParam } = await searchParams;
  const hoje = todayISO();
  const dia = isISODate(dataParam) && dataParam <= hoje ? dataParam : hoje;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resumo_assessores_dia", { p_data: dia });
  const linhas = ((data ?? []) as Linha[]);
  const gestao = can(profile, "consultores.manage");
  const tot = linhas.reduce(
    (a, l) => ({ processos: a.processos + l.processos, clientes: a.clientes + l.clientes, paradas: a.paradas + l.paradas, visitadas: a.visitadas + l.visitadas, rotas: a.rotas + l.rotas }),
    { processos: 0, clientes: 0, paradas: 0, visitadas: 0, rotas: 0 },
  );
  const navBtn = "inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2";

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Resumo diário dos assessores"
        description={`${fmtDia(dia)} · processos novos adquiridos e rotas do dia${gestao ? "" : " (o seu resumo)"}. O resumo também chega como notificação às 20h30.`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/comercial/resumo-diario?data=${addDays(dia, -1)}`} className={navBtn} aria-label="Dia anterior"><ChevronLeft className="h-4 w-4" /></Link>
            {dia !== hoje && <Link href="/comercial/resumo-diario" className={navBtn}>Hoje</Link>}
            {dia < hoje && <Link href={`/comercial/resumo-diario?data=${addDays(dia, 1)}`} className={navBtn} aria-label="Dia seguinte"><ChevronRight className="h-4 w-4" /></Link>}
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Processos novos" value={num(tot.processos)} icon={<FolderPlus className="h-5 w-5" />} tone="accent" />
        <StatCard label="Clientes novos" value={num(tot.clientes)} icon={<UserPlus className="h-5 w-5" />} />
        <StatCard label="Rotas no dia" value={num(tot.rotas)} icon={<Route className="h-5 w-5" />} tone="green" />
        <StatCard label="Paradas visitadas" value={`${num(tot.visitadas)} de ${num(tot.paradas)}`} icon={<MapPin className="h-5 w-5" />} tone="amber" />
      </div>
      <Card>
        {error ? (
          <EmptyState title="Não foi possível carregar" description="Tente novamente em instantes." />
        ) : linhas.length === 0 ? (
          <EmptyState title="Nenhum assessor" description={gestao ? "Cadastre os assessores em Comercial › Assessores." : "Seu usuário ainda não está ligado a um cadastro de assessor. Peça à gestão."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Assessor</th><th className="text-right">Processos novos</th><th>Tipos</th><th className="text-right">Clientes novos</th><th>Rota do dia</th></tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className={l.processos || l.rotas ? "" : "text-muted"}>
                    <td className="font-semibold">{l.nome}{l.acordo && <Badge tone="green" className="ml-2">acordo</Badge>}</td>
                    <td className="text-right text-lg font-bold tabular-nums">{num(l.processos)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(l.por_tipo).map(([t, n]) => <Badge key={t} tone="brand">{optionLabel(TIPOS_ACAO, t)}: {n}</Badge>)}
                        {!Object.keys(l.por_tipo).length && <span className="text-xs">—</span>}
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{num(l.clientes)}</td>
                    <td className="text-sm">
                      {!l.tem_usuario ? (
                        <span className="text-xs text-muted">sem usuário no sistema</span>
                      ) : l.rotas === 0 ? (
                        <span className="text-xs">sem rota</span>
                      ) : (
                        <div>
                          <span className={cn("font-semibold", l.visitadas === l.paradas && l.paradas > 0 ? "text-emerald-600 dark:text-emerald-400" : "")}>{l.visitadas} de {l.paradas} parada(s)</span>
                          <div className="text-xs text-muted">
                            {l.rotas_concluidas} de {l.rotas} rota(s) concluída(s){l.nao_realizadas ? ` · ${l.nao_realizadas} não realizada(s)` : ""}{Number(l.km_planejado) ? ` · ${num(Number(l.km_planejado))} km planejados` : ""}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
