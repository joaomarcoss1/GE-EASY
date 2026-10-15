import type { Metadata } from "next";
import { AlarmClock, CheckCheck, Inbox, Link2Off, Newspaper } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole } from "@/lib/rbac";
import { getProfileMap, juridicoOptions, pageRange, processoOptions, searchTerm } from "@/lib/data";
import { todayISO } from "@/lib/format";
import {
  deletePublicacao, gerarPrazoDaPublicacao, importarPublicacoes, marcarTratadasEmLote, setPublicacaoStatus, vincularPublicacao,
} from "@/lib/actions/publicacoes";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, SearchInput, SegmentTabs } from "@/components/ui/filters";
import { ImportarPublicacoes } from "@/components/publicacoes/importar";
import { BuscarDjenButton } from "@/components/integracoes/acao-botoes";
import { buscarIntimacoesDjen } from "@/lib/actions/integracoes";
import { PublicacoesLista, type PublicacaoView } from "@/components/publicacoes/publicacao-item";

export const metadata: Metadata = { title: "Publicações" };

export default async function PublicacoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("publicacoes.view");
  const sp = await searchParams;
  const aba = sp.aba ?? "novas";
  const { page, size, from, to } = pageRange(sp.page, 30);
  const supabase = await createClient();
  const hoje = todayISO();
  const semanaAtras = new Date(Date.now() - 7 * 86400000).toISOString();

  let query = supabase
    .from("publicacoes")
    .select("id, data_publicacao, fonte, numero_processo, conteudo, status, prazo_id, responsavel_id, processos(id, titulo, numero_cnj)", { count: "exact" })
    .order("data_publicacao", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (aba === "novas") query = query.eq("status", "nova");
  else if (aba === "sem_processo") query = query.is("processo_id", null).neq("status", "descartada");
  else if (aba === "tratadas") query = query.eq("status", "tratada");
  else if (aba === "descartadas") query = query.eq("status", "descartada");
  const q = searchTerm(sp.q);
  if (q) query = query.or(`conteudo.ilike.%${q}%,numero_processo.ilike.%${q}%,fonte.ilike.%${q}%`);

  const [{ data, count }, novas, semProc, tratadasHoje, prazosSemana, profiles, processos, responsaveis] = await Promise.all([
    query,
    supabase.from("publicacoes").select("id", { count: "exact", head: true }).eq("status", "nova"),
    supabase.from("publicacoes").select("id", { count: "exact", head: true }).is("processo_id", null).eq("status", "nova"),
    supabase.from("publicacoes").select("id", { count: "exact", head: true }).eq("status", "tratada").gte("tratado_em", `${hoje}T00:00:00-03:00`),
    supabase.from("publicacoes").select("id", { count: "exact", head: true }).not("prazo_id", "is", null).gte("tratado_em", semanaAtras),
    getProfileMap(),
    processoOptions(),
    juridicoOptions(),
  ]);

  const items: PublicacaoView[] = (data ?? []).map((p) => ({
    id: p.id,
    data_publicacao: p.data_publicacao,
    fonte: p.fonte,
    numero_processo: p.numero_processo,
    conteudo: p.conteudo,
    status: p.status,
    prazo_id: p.prazo_id,
    processo: (p.processos as unknown as PublicacaoView["processo"]) ?? null,
    responsavel: p.responsavel_id ? (profiles.get(p.responsavel_id)?.full_name ?? null) : null,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Jurídico"
        title="Publicações e intimações"
        description="Intimações do DJEN capturadas automaticamente pelas OABs da equipe (3x ao dia) ou importadas: vincule ao processo, gere o prazo e dê baixa."
        actions={
          <>
            <BuscarDjenButton action={buscarIntimacoesDjen} escopo={isManagerRole(profile.role) ? "de toda a equipe (perfis + lista do administrador)" : "do seu perfil"} />
            {can(profile.role, "processos.write") && <ImportarPublicacoes action={importarPublicacoes} />}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Publicações novas" value={novas.count ?? 0} icon={<Inbox className="h-5 w-5" />} tone={(novas.count ?? 0) > 0 ? "accent" : "green"} />
        <StatCard label="Sem processo vinculado" value={semProc.count ?? 0} icon={<Link2Off className="h-5 w-5" />} tone="amber" />
        <StatCard label="Tratadas hoje" value={tratadasHoje.count ?? 0} icon={<CheckCheck className="h-5 w-5" />} tone="green" />
        <StatCard label="Prazos gerados (7 dias)" value={prazosSemana.count ?? 0} icon={<AlarmClock className="h-5 w-5" />} />
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
          <SegmentTabs
            param="aba"
            options={[
              { value: "novas", label: "Novas" },
              { value: "sem_processo", label: "Sem processo" },
              { value: "tratadas", label: "Tratadas" },
              { value: "descartadas", label: "Descartadas" },
              { value: "todas", label: "Todas" },
            ]}
          />
          <SearchInput placeholder="Buscar no teor, nº do processo, fonte…" />
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={<Newspaper className="h-6 w-6" />}
            title={aba === "novas" ? "Nenhuma publicação pendente" : "Nada por aqui"}
            description={aba === "novas" ? "Importe as publicações do dia colando o texto do Diário de Justiça." : "Ajuste os filtros para ver outras publicações."}
          />
        ) : (
          <PublicacoesLista
            items={items}
            processos={processos}
            responsaveis={responsaveis}
            canDelete={can(profile.role, "processos.delete")}
            lote={marcarTratadasEmLote}
            actions={{ vincular: vincularPublicacao, status: setPublicacaoStatus, gerarPrazo: gerarPrazoDaPublicacao, remove: deletePublicacao }}
          />
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}
