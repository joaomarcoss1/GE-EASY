import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileBarChart } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { CASO_PENDENCIAS, CASO_STATUS } from "@/lib/constants";
import { date, maskDocumento, num, todayISO } from "@/lib/format";
import { carregarRelatorio, lerFiltroRelatorio, type CasoRelatorio } from "@/lib/relatorio-assessor";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Relatório por assessor" };

const ATIVOS_FIM = ["arquivo_morto", "indeferido"];

/** Relatório por consultor/assessor: processos gerados, status, datas, pendências e prazos. */
export default async function RelatorioAssessoresPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.ver_todos");
  const sp = await searchParams;
  const f = lerFiltroRelatorio(sp);
  const supabase = await createClient();
  const [casos, { data: assessoresData }] = await Promise.all([
    carregarRelatorio(f),
    supabase.from("assessores").select("id, nome, categoria, ativo").order("nome"),
  ]);
  const assessores = (assessoresData ?? []) as { id: string; nome: string; categoria: string; ativo: boolean }[];
  const nome = (id: string | null) => (id ? (assessores.find((a) => a.id === id)?.nome ?? "—") : "Sem assessor");
  const hoje = todayISO();
  const porStatus = (lista: CasoRelatorio[]) => Object.fromEntries(CASO_STATUS.map((s) => [s.value, lista.filter((c) => c.status === s.value).length]));
  const st = porStatus(casos);
  const exigAbertas = casos.filter((c) => c.status === "exigencia");
  const exigVencidas = exigAbertas.filter((c) => c.exigencia_prazo && c.exigencia_prazo < hoje).length;
  const semAssinatura = casos.filter((c) => c.assinaturas === "faltando" && !ATIVOS_FIM.includes(c.status)).length;
  const comPendencia = casos.filter((c) => c.pendencia && !ATIVOS_FIM.includes(c.status)).length;
  const grupos = new Map<string, CasoRelatorio[]>();
  for (const c of casos) grupos.set(c.assessor_id ?? "sem", [...(grupos.get(c.assessor_id ?? "sem") ?? []), c]);
  const ranking = [...grupos.entries()].sort((a, b) => b[1].length - a[1].length);
  const qs = new URLSearchParams({ de: f.de, ate: f.ate, ...(f.assessor ? { assessor: f.assessor } : {}) }).toString();
  const titulo = f.assessor ? nome(f.assessor === "sem" ? null : f.assessor) : "Todos os assessores";

  return (
    <>
      <PageHeader
        eyebrow="Relatórios"
        title="Relatório por assessor"
        description={`${titulo} · processos recebidos de ${date(f.de)} a ${date(f.ate)}`}
        actions={can(profile, "clientes.exportar") && (
          <LinkButton href={`/api/relatorios/assessores?${qs}`} variant="secondary" prefetch={false}><Download className="h-4 w-4" /> Exportar planilha</LinkButton>
        )}
      />
      <Card className="mb-6">
        <form className="flex flex-col flex-wrap gap-3 p-4 sm:flex-row sm:items-end" method="get">
          <label className="block min-w-[220px] flex-1 text-sm"><span className="label">Assessor / consultor</span>
            <select name="assessor" defaultValue={f.assessor ?? ""} className="input">
              <option value="">Todos</option>
              <option value="sem">Sem assessor</option>
              {assessores.map((a) => <option key={a.id} value={a.id}>{a.nome}{a.ativo ? "" : " (inativo)"}</option>)}
            </select>
          </label>
          <label className="block text-sm"><span className="label">De</span><input type="date" name="de" defaultValue={f.de} max={hoje} className="input" /></label>
          <label className="block text-sm"><span className="label">Até</span><input type="date" name="ate" defaultValue={f.ate} max={hoje} className="input" /></label>
          <button type="submit" className="h-10 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">Gerar relatório</button>
        </form>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Processos gerados" value={num(casos.length)} icon={<FileBarChart className="h-5 w-5" />} hint={`${new Set(casos.map((c) => c.cliente_id)).size} cliente(s)`} />
        <StatCard label="Habilitados" value={num(st.habilitado ?? 0)} tone="green" hint={`${num(st.deferido ?? 0)} deferido(s)`} />
        <StatCard label="Exigências abertas" value={num(exigAbertas.length)} tone={exigVencidas ? "amber" : "brand"} hint={exigVencidas ? `${exigVencidas} com prazo vencido` : "Nenhuma vencida"} />
        <StatCard label="Com pendência" value={num(comPendencia)} tone="amber" hint={`${num(st.pendencia ?? 0)} no status Pendência`} />
        <StatCard label="Sem assinatura" value={num(semAssinatura)} tone={semAssinatura ? "amber" : "green"} hint="Contrato ou procuração" />
      </div>

      <Card className="mb-6">
        <CardHeader title="Por status" />
        <div className="flex flex-wrap gap-2 p-4">
          {CASO_STATUS.map((s) => <span key={s.value} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm"><b className="tabular-nums">{num(st[s.value] ?? 0)}</b> <span className="text-muted">{s.label}</span></span>)}
        </div>
      </Card>

      {!f.assessor && ranking.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Resumo por assessor" description="Clique para ver só os processos de um assessor" />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Assessor</th><th className="text-right">Processos</th><th className="text-right">Em análise</th><th className="text-right">Pendência</th><th className="text-right">Exigência</th><th className="text-right">Habilitados</th><th className="text-right">Deferidos</th><th className="text-right">Sem assinatura</th></tr></thead>
              <tbody>
                {ranking.map(([id, lista]) => {
                  const s = porStatus(lista);
                  return (
                    <tr key={id}>
                      <td><Link href={`/relatorios/assessores?${new URLSearchParams({ de: f.de, ate: f.ate, assessor: id }).toString()}`} className="font-semibold hover:text-brand-600">{nome(id === "sem" ? null : id)}</Link></td>
                      <td className="text-right font-bold tabular-nums">{num(lista.length)}</td>
                      <td className="text-right tabular-nums">{num(s.em_analise)}</td>
                      <td className="text-right tabular-nums">{num(s.pendencia)}</td>
                      <td className="text-right tabular-nums">{num(s.exigencia)}</td>
                      <td className="text-right tabular-nums">{num(s.habilitado)}</td>
                      <td className="text-right tabular-nums">{num(s.deferido)}</td>
                      <td className="text-right tabular-nums">{num(lista.filter((c) => c.assinaturas === "faltando").length)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Processos (${num(casos.length)})`} description="Datas, status, pendências e prazos" />
        {casos.length === 0 ? (
          <EmptyState title="Nenhum processo no período" description="Ajuste o assessor ou as datas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Cliente</th><th>Tipo</th>{!f.assessor && <th>Assessor</th>}<th>Recebido</th><th>Status</th><th>Habilitação / protocolo</th><th>Pendência / prazo</th></tr></thead>
              <tbody>
                {casos.slice(0, 500).map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/clientes/${c.cliente_id}`} className="font-semibold hover:text-brand-600">{c.clientes.nome}</Link><div className="text-xs text-muted">{c.clientes.documento ? maskDocumento(c.clientes.documento) : "sem CPF"}{c.cidade ? ` · ${c.cidade}` : ""}</div></td>
                    <td className="whitespace-nowrap text-sm">{c.tipo}</td>
                    {!f.assessor && <td className="text-sm">{c.assessor_id ? nome(c.assessor_id) : (c.corretor ?? "—")}</td>}
                    <td className="whitespace-nowrap text-sm">{c.recebido_em ? date(c.recebido_em) : "—"}</td>
                    <td><StatusBadge options={CASO_STATUS} value={c.status} />{c.situacao_atual && <div className="mt-1 max-w-[220px] text-xs text-muted">{c.situacao_atual}</div>}</td>
                    <td className="text-sm">{c.habilitado_em ? date(c.habilitado_em) : "—"}<div className="text-xs text-muted">{c.protocolo_inss ? `Protocolo ${c.protocolo_inss}` : c.status === "habilitado" ? <span className="text-red-600">sem protocolo</span> : ""}</div></td>
                    <td className="text-sm">
                      <div className="flex flex-wrap gap-1">
                        {c.pendencia && <Badge tone="amber">{optionLabel(CASO_PENDENCIAS, c.pendencia)}</Badge>}
                        {c.status === "exigencia" && c.exigencia_prazo && <Badge tone={c.exigencia_prazo < hoje ? "red" : "amber"}>exigência até {date(c.exigencia_prazo)}{c.exigencia_prorrogada ? " (prorrogada)" : ""}</Badge>}
                        {c.assinaturas === "faltando" && <Badge tone="red">sem assinatura</Badge>}
                        {!c.pendencia && c.status !== "exigencia" && c.assinaturas !== "faltando" && <span className="text-xs text-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {casos.length > 500 && <p className="px-5 py-3 text-xs text-muted">Mostrando 500 de {num(casos.length)}. Exporte a planilha para ver todos.</p>}
          </div>
        )}
      </Card>
    </>
  );
}
