import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardList, FolderArchive, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { date, dateTime, num, todayISO } from "@/lib/format";
import { rangeParam } from "@/components/dashboard/periods";
import { carregarEquipe, INDICADOR_ROTULO, totalAcoes, type LinhaEquipe } from "@/lib/equipe";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { optionLabel } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Relatório da equipe" };

/** Meta individual mensal: o primeiro indicador com meta e quanto já foi feito. */
function principal(l: LinhaEquipe) {
  const ind = Object.keys(l.metas).find((k) => k in INDICADOR_ROTULO);
  if (!ind) return null;
  const feito = Number((l as unknown as Record<string, number>)[ind] ?? 0);
  return { ind, feito, meta: l.metas[ind] };
}

/** O que cada pessoa da equipe interna (Pendências, Exigências, Análise, Habilitação) fez no período. */
export default async function RelatorioEquipePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // metas e produção de todos: só o master e quem recebeu "metas.ver_equipe"
  await requirePermission("metas.ver_equipe");
  const sp = await searchParams;
  const { de, ate } = rangeParam(sp.de, sp.ate);
  const hoje = todayISO();
  const linhas = (await carregarEquipe(de, ate > hoje ? hoje : ate)).sort((a, b) => totalAcoes(b) - totalAcoes(a) || a.nome.localeCompare(b.nome));
  const soma = (k: keyof LinhaEquipe) => linhas.reduce((a, l) => a + Number(l[k] ?? 0), 0);
  const parados = linhas.filter((l) => totalAcoes(l) === 0);
  const mesAtual = de.slice(0, 7) === hoje.slice(0, 7) && ate.slice(0, 7) === hoje.slice(0, 7);

  return (
    <>
      <PageHeader
        eyebrow="Relatórios"
        title="Relatório da equipe"
        description={`O que cada pessoa registrou no sistema de ${date(de)} a ${date(ate)}. Os assessores estão no relatório por assessor.`}
        actions={<LinkButton href="/relatorios/assessores" variant="secondary" size="sm">Relatório por assessor</LinkButton>}
      />
      <Card className="mb-6">
        <form className="flex flex-col flex-wrap gap-3 p-4 sm:flex-row sm:items-end" method="get">
          <label className="block text-sm"><span className="label">De</span><input type="date" name="de" defaultValue={de} max={hoje} className="input" /></label>
          <label className="block text-sm"><span className="label">Até</span><input type="date" name="ate" defaultValue={ate} className="input" /></label>
          <button type="submit" className="h-10 rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">Gerar relatório</button>
        </form>
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Análises feitas" value={num(soma("analises"))} icon={<CheckCircle2 className="h-5 w-5" />} tone="brand" hint="Processos que saíram de Em análise" />
        <StatCard label="Pendências resolvidas" value={num(soma("pendencias_resolvidas"))} icon={<ClipboardList className="h-5 w-5" />} tone="amber" hint={`${num(soma("fichas_encerradas"))} ficha(s) encerrada(s)`} />
        <StatCard label="Exigências cumpridas" value={num(soma("exigencias_cumpridas"))} icon={<ClipboardList className="h-5 w-5" />} tone="accent" hint={`${num(soma("enviados_habilitacao"))} enviado(s) para habilitação`} />
        <StatCard label="Habilitações" value={num(soma("habilitados"))} icon={<FolderArchive className="h-5 w-5" />} tone="green" hint={`${num(soma("dossies"))} dossiê(s) gerado(s)`} />
      </div>

      {parados.length > 0 && (
        <p className="mb-6 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><b>Sem nada registrado no período:</b> {parados.map((l) => l.nome).join(", ")}. O relatório conta o que é feito dentro do sistema (mudar o status do processo, fichas, dossiês e o resumo do dia). Trabalho feito só em planilha ou papel não aparece aqui.</span>
        </p>
      )}

      <Card>
        <CardHeader icon={<Users className="h-4 w-4" />} title={`Equipe (${linhas.length})`} description="Contado pelo histórico de status: cada mudança conta para quem a fez." />
        {linhas.length === 0 ? (
          <EmptyState title="Nenhuma pessoa encontrada" description="Confira as datas ou os acessos da equipe." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pessoa</th>
                  {mesAtual && <th>Meta do mês</th>}
                  <th className="text-right">Análises</th>
                  <th className="text-right">Pendências resolvidas</th>
                  <th className="text-right">Exigências cumpridas</th>
                  <th className="text-right">Enviou p/ análise</th>
                  <th className="text-right">Enviou p/ habilitação</th>
                  <th className="text-right">Habilitou</th>
                  <th className="text-right">Fichas abertas / encerradas</th>
                  <th className="text-right">Fichas recebidas</th>
                  <th className="text-right">Dossiês</th>
                  <th className="text-right">Resumos do dia</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const p = principal(l);
                  const cel = (n: number) => <td className={cn("text-right tabular-nums", n ? "font-semibold" : "text-muted")}>{num(n)}</td>;
                  return (
                    <tr key={l.usuario_id}>
                      <td>
                        <span className="font-semibold">{l.nome}</span>
                        <div className="text-xs text-muted">{optionLabel(ROLES, l.papel)} · {l.ultimo_acesso ? `último acesso ${dateTime(l.ultimo_acesso)}` : "nunca entrou"}</div>
                      </td>
                      {mesAtual && (
                        <td className="whitespace-nowrap text-sm">
                          {p ? (
                            <>
                              <b className="tabular-nums">{num(p.feito)}</b> de {num(p.meta)} <span className="text-muted">{INDICADOR_ROTULO[p.ind]}</span>
                              <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-brand-600" style={{ width: `${Math.min(100, (p.feito / Math.max(1, p.meta)) * 100)}%` }} /></div>
                            </>
                          ) : <span className="text-xs text-muted">sem meta individual</span>}
                        </td>
                      )}
                      {cel(l.analises)}
                      {cel(l.pendencias_resolvidas)}
                      {cel(l.exigencias_cumpridas)}
                      {cel(l.enviados_analise)}
                      {cel(l.enviados_habilitacao)}
                      {cel(l.habilitados)}
                      <td className="text-right tabular-nums">{num(l.fichas_abertas)} / {num(l.fichas_encerradas)}</td>
                      {cel(l.fichas_recebidas)}
                      {cel(l.dossies)}
                      <td className="text-right tabular-nums">{num(l.resumos)}{l.processos_trabalhados ? <div className="text-xs text-muted">{num(l.processos_trabalhados)} proc. trabalhados</div> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 text-xs text-muted">
        Metas individuais em <Link href="/metas/processos" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">Metas</Link>. Resumos enviados em <Link href="/comercial/resumo-diario" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">Resumo diário</Link>.
      </p>
    </>
  );
}
