import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, History, ShieldCheck, ShieldAlert } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap, pageRange } from "@/lib/data";
import { ACOES_AUDITORIA, TABELAS_ACESSO, TABELAS_AUDITADAS } from "@/lib/auditoria";
import { dateTime, num } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { AuditLogList, type AuditItem } from "@/components/configuracoes/audit-log-list";
import { DateRangeFilter } from "@/components/configuracoes/audit-filters";

export const metadata: Metadata = { title: "Auditoria" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Período (padrão: últimos 30 dias) no fuso de Brasília. */
function periodo(sp: Record<string, string | undefined>) {
  const ate = sp.ate && ISO.test(sp.ate) ? sp.ate : new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const de = sp.de && ISO.test(sp.de) ? sp.de : new Date(Date.now() - 3 * 3600_000 - 30 * 86400_000).toISOString().slice(0, 10);
  return { de, ate, inicio: `${de}T00:00:00-03:00`, fim: new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86400_000).toISOString() };
}

/**
 * Auditoria completa: o que foi incluído, alterado, excluído ou acessado, por quem, quando e de onde.
 * Trilha imutável e selada por hash; relatórios por funcionário, linha do tempo de um registro e
 * verificação de integridade.
 */
export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("auditoria.view");
  const sp = await searchParams;
  const tab = ["eventos", "funcionarios", "integridade"].includes(sp.tab ?? "") ? sp.tab! : "eventos";
  const p = periodo(sp);
  const exportar = `/api/exportar/auditoria?de=${p.de}&ate=${p.ate}`;
  return (
    <>
      <PageHeader
        eyebrow="Sistema"
        title="Auditoria"
        description="Trilha imutável de inclusões, alterações, exclusões e acessos sensíveis — com o valor anterior de cada campo."
        actions={<><PrintButton /><LinkButton href={exportar} variant="secondary" prefetch={false}>Exportar CSV (Excel)</LinkButton></>}
      />
      <LinkTabs base="/auditoria" active={tab} tabs={[{ key: "eventos", label: "Eventos" }, { key: "funcionarios", label: "Por funcionário" }, { key: "integridade", label: "Integridade" }]} />
      {tab === "eventos" && <Eventos sp={sp} p={p} />}
      {tab === "funcionarios" && <PorFuncionario sp={sp} p={p} />}
      {tab === "integridade" && <Integridade />}
    </>
  );
}

async function Eventos({ sp, p }: { sp: Record<string, string | undefined>; p: ReturnType<typeof periodo> }) {
  const supabase = await createClient();
  const { page, size, from, to } = pageRange(sp.page, 30);
  let query = supabase.from("audit_logs").select("*", { count: "estimated" }).gte("created_at", p.inicio).lt("created_at", p.fim).order("created_at", { ascending: false }).range(from, to);
  if (sp.grupo === "acessos") query = query.in("tabela", TABELAS_ACESSO);
  else if (sp.tabela && TABELAS_AUDITADAS[sp.tabela]) query = query.eq("tabela", sp.tabela);
  if (sp.registro && UUID.test(sp.registro)) query = query.eq("registro_id", sp.registro);
  if (sp.acao && ACOES_AUDITORIA.some((a) => a.value === sp.acao)) query = query.eq("acao", sp.acao);
  if (sp.usuario && UUID.test(sp.usuario)) query = query.eq("actor_id", sp.usuario);
  const [{ data, count }, profiles] = await Promise.all([query, getProfileMap()]);
  const items: AuditItem[] = (data ?? []).map((l) => ({
    id: l.id,
    created_at: l.created_at,
    actor: l.actor_id ? (profiles.get(l.actor_id)?.full_name ?? l.actor_email ?? "Usuário removido") : "Sistema",
    acao: l.acao,
    tabela: l.tabela,
    tabelaLabel: `${TABELAS_AUDITADAS[l.tabela] ?? l.tabela}${l.area ? ` · ${l.area}` : ""}${l.origem && l.origem !== "web" ? ` · ${l.origem}` : ""}${l.ip ? ` · ${l.ip}` : ""}`,
    registro_id: l.registro_id,
    dados_antigos: l.dados_antigos,
    dados_novos: l.dados_novos,
  }));
  const usuarios = [...profiles.values()].map((u) => ({ value: u.id, label: u.full_name || u.email }));
  return (
    <Card>
      <CardHeader
        title={sp.registro ? "Linha do tempo do registro" : sp.grupo === "acessos" ? "Histórico de acessos" : "Eventos"}
        description={sp.registro ? `Todas as alterações do registro ${sp.registro.slice(0, 8)}… no período` : "Clique num evento para ver o antes → depois"}
        icon={<History className="h-4 w-4" />}
        action={(sp.registro || sp.grupo) && <Link href="/auditoria" className="text-sm font-semibold text-brand-600">Limpar</Link>}
      />
      <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <FilterSelect param="tabela" options={Object.entries(TABELAS_AUDITADAS).map(([value, label]) => ({ value, label }))} allLabel="Todas as tabelas" />
        <FilterSelect param="acao" options={ACOES_AUDITORIA} allLabel="Todas as ações" />
        <FilterSelect param="usuario" options={usuarios} allLabel="Todos os usuários" />
        <Suspense><DateRangeFilter /></Suspense>
      </div>
      {items.length === 0 ? <EmptyState title="Nenhum evento no período" /> : <AuditLogList items={items} />}
      <Pagination page={page} pageSize={size} total={count ?? 0} />
    </Card>
  );
}

interface LinhaFuncionario {
  actor_id: string | null; actor_email: string | null; nome: string | null;
  inclusoes: number; alteracoes: number; exclusoes: number; restauracoes: number; acessos: number; total: number; primeira: string; ultima: string;
}

async function PorFuncionario({ sp, p }: { sp: Record<string, string | undefined>; p: ReturnType<typeof periodo> }) {
  const supabase = await createClient();
  const alvo = sp.usuario && UUID.test(sp.usuario) ? sp.usuario : null;
  const [{ data: linhas, error }, { data: modulos }] = await Promise.all([
    supabase.rpc("auditoria_por_funcionario", { p_inicio: p.inicio, p_fim: p.fim }),
    alvo ? supabase.rpc("auditoria_por_modulo", { p_actor: alvo, p_inicio: p.inicio, p_fim: p.fim }) : Promise.resolve({ data: null }),
  ]);
  const lista = (linhas ?? []) as LinhaFuncionario[];
  const total = lista.reduce((a, l) => a + Number(l.total), 0);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Atividade por funcionário" description={`${p.de.split("-").reverse().join("/")} a ${p.ate.split("-").reverse().join("/")} · ${num(total)} evento(s)`} icon={<BarChart3 className="h-4 w-4" />} />
        <div className="border-b border-line p-4"><Suspense><DateRangeFilter /></Suspense></div>
        {error ? <EmptyState title="Não foi possível gerar o relatório" description={error.message} /> : lista.length === 0 ? <EmptyState title="Sem atividade no período" /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Funcionário</th><th className="text-right">Inclusões</th><th className="text-right">Alterações</th><th className="text-right">Exclusões</th><th className="text-right">Restaurações</th><th className="text-right">Acessos</th><th className="text-right">Total</th><th>Última atividade</th></tr></thead>
            <tbody>
              {lista.map((l) => (
                <tr key={l.actor_id ?? "sistema"} className={alvo === l.actor_id ? "bg-brand-50/50 dark:bg-brand-900/20" : undefined}>
                  <td>{l.actor_id ? <Link href={`/auditoria?tab=funcionarios&usuario=${l.actor_id}&de=${p.de}&ate=${p.ate}`} className="font-medium hover:text-brand-600">{l.nome ?? l.actor_email}</Link> : <span className="text-muted">Sistema / rotinas</span>}</td>
                  <td className="text-right">{num(l.inclusoes)}</td>
                  <td className="text-right">{num(l.alteracoes)}</td>
                  <td className="text-right font-semibold text-red-600">{num(l.exclusoes)}</td>
                  <td className="text-right">{num(l.restauracoes)}</td>
                  <td className="text-right">{num(l.acessos)}</td>
                  <td className="text-right font-bold">{num(l.total)}</td>
                  <td className="whitespace-nowrap text-xs text-muted">{dateTime(l.ultima)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      {alvo && (
        <Card>
          <CardHeader title="Por módulo" description="Clique para ver a lista detalhada com antes → depois" />
          {((modulos ?? []) as { tabela: string; inclusoes: number; alteracoes: number; exclusoes: number; acessos: number; total: number }[]).length === 0 ? <EmptyState title="Sem eventos" /> : (
            <div className="overflow-x-auto"><table className="table-base">
              <thead><tr><th>Módulo</th><th className="text-right">Inclusões</th><th className="text-right">Alterações</th><th className="text-right">Exclusões</th><th className="text-right">Acessos</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {((modulos ?? []) as { tabela: string; inclusoes: number; alteracoes: number; exclusoes: number; acessos: number; total: number }[]).map((m) => (
                  <tr key={m.tabela}>
                    <td><Link href={`/auditoria?usuario=${alvo}&tabela=${m.tabela}&de=${p.de}&ate=${p.ate}`} className="font-medium hover:text-brand-600">{TABELAS_AUDITADAS[m.tabela] ?? m.tabela}</Link></td>
                    <td className="text-right">{num(m.inclusoes)}</td><td className="text-right">{num(m.alteracoes)}</td><td className="text-right">{num(m.exclusoes)}</td><td className="text-right">{num(m.acessos)}</td><td className="text-right font-bold">{num(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

async function Integridade() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("auditoria_verificar");
  const r = (Array.isArray(data) ? data[0] : data) as { verificados: number; pendentes: number; adulterado_id: number | null; integra: boolean } | null;
  return (
    <Card>
      <CardHeader title="Integridade da trilha" description="Cada evento é selado por hash encadeado (SHA-256) a cada 5 minutos; qualquer alteração posterior quebra a cadeia." icon={r?.integra === false ? <ShieldAlert className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />} />
      <CardBody>
        {error || !r ? (
          <p className="text-sm text-red-600">Não foi possível verificar agora{error ? `: ${error.message}` : ""}.</p>
        ) : r.integra ? (
          <p className="text-sm"><b className="text-emerald-700 dark:text-emerald-300">Íntegra.</b> {num(r.verificados)} evento(s) selado(s) conferido(s); {num(r.pendentes)} aguardando o próximo selo.</p>
        ) : (
          <p className="text-sm text-red-700 dark:text-red-300"><b>Adulteração detectada</b> a partir do evento nº {r.adulterado_id} (após {num(r.verificados)} evento(s) íntegros). Acione a segurança e preserve as cópias de segurança.</p>
        )}
      </CardBody>
    </Card>
  );
}
