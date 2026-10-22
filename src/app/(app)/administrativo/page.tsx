import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, ArrowRightLeft, Database, FileCheck2, Scale } from "lucide-react";
import { requireArea } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { ENCAMINHAMENTO_STATUS } from "@/lib/constants";
import { date, dateTime, todayISO } from "@/lib/format";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Administrativo" };

const somaDias = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00-03:00`).getTime() + n * 86400_000).toISOString();

/** Entrada do administrativo: fila documental, transferidos pela regra do prazo, pendências por consultor e encaminhamentos. */
export default async function AdministrativoPage() {
  const { profile } = await requireArea("administrativo");
  const supabase = await createClient();
  const hoje = todayISO();
  const [{ count: fila }, { count: transferidos }, { count: vencendo }, pendentes, { data: recentes }, { data: encaminhamentos }, nomes] = await Promise.all([
    supabase.from("documentos").select("id", { count: "exact", head: true }).in("analise_status", ["enviado", "em_analise"]).not("cliente_id", "is", null),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("status_cadastro", "transferido_administrativo"),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("status_cadastro", "pendente_documentacao").lte("prazo_documentacao", somaDias(hoje, 7)),
    fetchAll<{ consultor_id: string | null }>((from, to) => supabase.from("clientes").select("consultor_id").eq("status_cadastro", "pendente_documentacao").eq("carteira", "consultor").range(from, to)),
    supabase.from("clientes").select("id, nome, transferido_em, consultor_original_id").eq("status_cadastro", "transferido_administrativo").order("transferido_em", { ascending: false }).limit(10),
    can(profile, "processos.view")
      ? supabase.from("processos").select("id, titulo, situacao_encaminhamento, encaminhado_em").not("situacao_encaminhamento", "is", null).order("encaminhado_em", { ascending: false }).limit(10)
      : Promise.resolve({ data: [] as { id: string; titulo: string; situacao_encaminhamento: string; encaminhado_em: string }[] }),
    getProfileMap(),
  ]);
  const porConsultor = new Map<string, number>();
  for (const p of pendentes) if (p.consultor_id) porConsultor.set(p.consultor_id, (porConsultor.get(p.consultor_id) ?? 0) + 1);
  const ranking = [...porConsultor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow="Área administrativa"
        title="Painel administrativo"
        description="Documentação, base de clientes e encaminhamentos da empresa."
        actions={
          <>
            {can(profile, "documentacao.analisar") && <LinkButton href="/administrativo/documentacao" variant="accent"><FileCheck2 className="h-4 w-4" />Central de documentação</LinkButton>}
            <LinkButton href="/administrativo/base" variant="secondary"><Database className="h-4 w-4" />Base de clientes</LinkButton>
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Documentos para analisar" value={fila ?? 0} icon={<FileCheck2 className="h-5 w-5" />} tone={fila ? "amber" : "green"} />
        <StatCard label="Transferidos (prazo esgotado)" value={transferidos ?? 0} icon={<ArrowRightLeft className="h-5 w-5" />} tone="accent" hint="Na base administrativa" />
        <StatCard label="Prazos vencendo em 7 dias" value={vencendo ?? 0} icon={<AlarmClock className="h-5 w-5" />} tone={vencendo ? "amber" : "brand"} />
        <StatCard label="Pendências com consultores" value={pendentes.length} icon={<Database className="h-5 w-5" />} />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Pendências por consultor" />
          {ranking.length === 0 ? <EmptyState title="Sem pendências" /> : (
            <ul className="divide-y divide-line text-sm">
              {ranking.map(([id, n]) => (
                <li key={id} className="flex justify-between px-5 py-2.5"><Link href={`/administrativo/base?consultor=${id}&cadastro=pendente_documentacao`} className="hover:text-brand-600">{nomes.get(id)?.full_name ?? "Consultor"}</Link><b>{n}</b></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Transferidos recentemente" description="Concluir documentação e redistribuir" />
          {(recentes ?? []).length === 0 ? <EmptyState title="Nenhum transferido" /> : (
            <ul className="divide-y divide-line text-sm">
              {(recentes ?? []).map((c) => (
                <li key={c.id} className="px-5 py-2.5">
                  <Link href={`/clientes/${c.id}`} className="font-medium hover:text-brand-600">{c.nome}</Link>
                  <p className="text-xs text-muted">{dateTime(c.transferido_em)} · de {c.consultor_original_id ? (nomes.get(c.consultor_original_id)?.full_name ?? "consultor") : "—"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can(profile, "processos.view") && (
          <Card>
            <CardHeader title="Encaminhamentos ao jurídico" icon={<Scale className="h-4 w-4" />} />
            {(encaminhamentos ?? []).length === 0 ? <EmptyState title="Nenhum encaminhamento" /> : (
              <ul className="divide-y divide-line text-sm">
                {(encaminhamentos ?? []).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                    <span className="min-w-0"><Link href={`/processos/${p.id}`} className="block truncate font-medium hover:text-brand-600">{p.titulo}</Link><span className="text-xs text-muted">{date(p.encaminhado_em)}</span></span>
                    <StatusBadge options={ENCAMINHAMENTO_STATUS} value={p.situacao_encaminhamento} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
