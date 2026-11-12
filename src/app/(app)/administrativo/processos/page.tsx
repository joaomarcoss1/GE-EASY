import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, Download, FolderSearch, List, MessageCircle } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { pageRange } from "@/lib/data";
import { CASO_PENDENCIAS, CASO_STATUS, type Option } from "@/lib/constants";
import { date, maskDocumento, num, whatsappLink } from "@/lib/format";
import { aplicarFiltros, argsResumo, lerFiltros, qs, SELECT_CASOS, type FiltrosCasos, type LinhaResumo, type ResumoCasos } from "@/lib/casos";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Processos dos clientes" };

interface Caso {
  id: string;
  cliente_id: string;
  ano: number | null;
  tipo: string;
  corretor: string | null;
  cidade: string | null;
  uf: string | null;
  recebido_em: string | null;
  habilitado_em: string | null;
  exigencia_cumprida: boolean;
  pericia_em: string | null;
  avaliacao_em: string | null;
  status: string;
  pendencia: string | null;
  situacao_planilha: string | null;
  observacoes: string | null;
  clientes: { id: string; nome: string; documento: string | null; whatsapp: string | null; telefone: string | null };
}

const TONS: Record<string, string> = {
  em_preparacao: "bg-sky-500", habilitado: "bg-emerald-500", pericia: "bg-violet-500", exigencia: "bg-red-500",
  pendencia: "bg-amber-500", aguardando_idade: "bg-brand-500", comercial: "bg-accent-500", arquivo_morto: "bg-slate-400",
};

/** Base de processos administrativos (benefícios) com busca por consultor, cidade, tipo e situação, e relatórios para a gestão. */
export default async function ProcessosClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.ver_todos");
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const aba = sp.aba === "relatorios" ? "relatorios" : "lista";
  const { page, size, from, to } = pageRange(sp.page, 50);
  const supabase = await createClient();

  const lista = aplicarFiltros(
    supabase.from("cliente_casos").select(SELECT_CASOS, { count: "exact" }).order("recebido_em", { ascending: false, nullsFirst: false }).range(from, to),
    f,
  );
  const [{ data, count, error }, { data: resumoData }, { data: opcoesData }] = await Promise.all([
    aba === "lista" ? lista : Promise.resolve({ data: [], count: null, error: null }),
    supabase.rpc("cliente_casos_resumo", argsResumo(f)),
    supabase.rpc("cliente_casos_opcoes"),
  ]);
  const casos = (data ?? []) as unknown as Caso[];
  const resumo = (resumoData ?? { total: 0, clientes: 0, por_status: {}, por_tipo: [], por_corretor: [], por_cidade: [], por_ano: {}, por_pendencia: {}, sem_assinatura: 0 }) as ResumoCasos;
  const op = (opcoesData ?? { tipos: [], cidades: [], corretores: [], anos: [] }) as { tipos: string[]; cidades: string[]; corretores: string[]; anos: number[] };
  const opcoes = (xs: (string | number)[]): Option[] => xs.map((x) => ({ value: String(x), label: String(x) }));
  const filtrando = !!(f.q || f.status || f.tipo || f.corretor || f.cidade || f.ano || f.pendencia);

  return (
    <>
      <PageHeader
        eyebrow="Administrativo"
        title="Processos dos clientes"
        description="Todos os processos (benefícios) da base, com a situação de cada um. Filtre por consultor, cidade, tipo e situação; veja os relatórios ou exporte."
        actions={can(profile, "clientes.exportar") && (
          <LinkButton href={`/api/casos/exportar${qs(f)}`} variant="secondary" prefetch={false}>
            <Download className="h-4 w-4" /> Exportar CSV
          </LinkButton>
        )}
      />

      {/* situação: cartões clicáveis (filtram a lista) */}
      <div className="stagger mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {CASO_STATUS.map((s) => {
          const n = resumo.por_status[s.value] ?? 0;
          const ativo = f.status === s.value;
          return (
            <Link
              key={s.value}
              href={`/administrativo/processos${qs(f, { status: ativo ? null : s.value, page: null })}${aba === "relatorios" ? "&aba=relatorios" : ""}`}
              scroll={false}
              className={cn("card card-interactive block p-3.5", ativo && "ring-2 ring-accent-500")}
            >
              <span className="flex items-center gap-2 text-[11.5px] font-medium text-muted"><span className={cn("h-2 w-2 rounded-full", TONS[s.value])} />{s.label}</span>
              <span className="mt-1.5 block text-xl font-bold tabular-nums">{num(n)}</span>
              <span className="text-[11px] text-muted">{resumo.total ? `${Math.round((n / resumo.total) * 100)}%` : "—"}</span>
            </Link>
          );
        })}
      </div>

      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <Suspense>
            <SearchInput placeholder="Nome ou CPF do cliente…" />
            <FilterSelect param="status" options={CASO_STATUS} allLabel="Toda situação" />
            <FilterSelect param="tipo" options={opcoes(op.tipos)} allLabel="Todos os tipos" />
            <FilterSelect param="corretor" options={opcoes(op.corretores)} allLabel="Todos os consultores" />
            <FilterSelect param="cidade" options={opcoes(op.cidades)} allLabel="Todas as cidades" />
            <FilterSelect param="ano" options={opcoes(op.anos)} allLabel="Todos os anos" />
            <FilterSelect param="pendencia" options={CASO_PENDENCIAS} allLabel="Qualquer pendência" />
          </Suspense>
          {filtrando && <Link href={`/administrativo/processos${aba === "relatorios" ? "?aba=relatorios" : ""}`} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">Limpar filtros</Link>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex gap-1">
            {[
              { k: "lista", l: "Lista", i: List },
              { k: "relatorios", l: "Relatórios", i: BarChart3 },
            ].map((t) => (
              <Link key={t.k} href={`/administrativo/processos${qs(f, { aba: t.k === "lista" ? null : t.k })}`} scroll={false}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition", aba === t.k ? "bg-brand-700 text-white" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                <t.i className="h-4 w-4" /> {t.l}
              </Link>
            ))}
          </div>
          <p className="text-sm text-muted">
            <b className="text-fg">{num(resumo.total)}</b> processo(s) de <b className="text-fg">{num(resumo.clientes)}</b> cliente(s)
            {resumo.sem_assinatura ? <> · <span className="text-amber-700 dark:text-amber-300">{num(resumo.sem_assinatura)} sem contrato/procuração assinados</span></> : null}
          </p>
        </div>

        {aba === "lista" ? (
          error ? <EmptyState title="Não foi possível carregar" description={error.message} /> : casos.length === 0 ? (
            <EmptyState icon={<FolderSearch className="h-6 w-6" />} title="Nenhum processo encontrado" description="Ajuste os filtros." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>Cliente</th><th>Tipo</th><th>Consultor</th><th>Cidade</th><th>Recebido</th><th>Habilitado</th><th>Situação</th><th /></tr>
                </thead>
                <tbody>
                  {casos.map((c) => {
                    const wa = whatsappLink(c.clientes.whatsapp || c.clientes.telefone);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/clientes/${c.cliente_id}`} className="font-semibold hover:text-brand-600">{c.clientes.nome}</Link>
                          <div className="text-xs text-muted">{c.clientes.documento ? maskDocumento(c.clientes.documento) : "sem CPF"}{c.ano ? ` · planilha ${c.ano}` : ""}</div>
                        </td>
                        <td className="whitespace-nowrap text-sm">{c.tipo}</td>
                        <td className="text-sm">{c.corretor ?? "—"}</td>
                        <td className="whitespace-nowrap text-sm">{c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{c.recebido_em ? date(c.recebido_em) : "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{c.habilitado_em ? date(c.habilitado_em) : "—"}</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge options={CASO_STATUS} value={c.status} />
                            {c.pendencia && <Badge tone="amber">{optionLabel(CASO_PENDENCIAS, c.pendencia)}</Badge>}
                            {c.exigencia_cumprida && <Badge tone="green">exigência cumprida</Badge>}
                          </div>
                          {c.observacoes && <div className="mt-1 max-w-xs truncate text-xs text-muted" title={c.observacoes}>{c.observacoes}</div>}
                        </td>
                        <td>
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" title="Conversar no WhatsApp" aria-label={`WhatsApp de ${c.clientes.nome}`} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-700">
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Relatorios resumo={resumo} f={f} />
        )}
        {aba === "lista" && <Suspense><Pagination page={page} pageSize={size} total={count ?? 0} /></Suspense>}
      </Card>
    </>
  );
}

/** Tabelas cruzadas (dimensão × situação). Cada linha leva à lista filtrada. */
function Relatorios({ resumo, f }: { resumo: ResumoCasos; f: FiltrosCasos }) {
  const blocos: { titulo: string; desc: string; linhas: LinhaResumo[]; param: keyof FiltrosCasos; limite?: number }[] = [
    { titulo: "Por tipo de processo", desc: "Quantidade e situação de cada tipo de benefício", linhas: resumo.por_tipo, param: "tipo" },
    { titulo: "Por consultor / corretor", desc: "Carteira de processos de cada consultor (processos com mais de um consultor contam para cada um)", linhas: resumo.por_corretor, param: "corretor", limite: 40 },
    { titulo: "Por cidade", desc: "Onde estão os processos", linhas: resumo.por_cidade, param: "cidade", limite: 40 },
  ];
  return (
    <div className="space-y-6 p-4 sm:p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Por ano da planilha" />
          <div className="space-y-2 p-5">
            {Object.entries(resumo.por_ano).sort().map(([ano, n]) => <Barra key={ano} rotulo={ano} n={n} total={resumo.total} href={`/administrativo/processos${qs(f, { ano: ano === "—" ? null : ano, aba: null })}`} />)}
          </div>
        </Card>
        <Card>
          <CardHeader title="Pendências" description="Motivo principal registrado no processo" />
          <div className="space-y-2 p-5">
            {CASO_PENDENCIAS.map((p) => <Barra key={p.value} rotulo={p.label} n={resumo.por_pendencia[p.value] ?? 0} total={resumo.total} href={`/administrativo/processos${qs(f, { pendencia: p.value, aba: null })}`} />)}
          </div>
        </Card>
      </div>
      {blocos.map((b) => (
        <Card key={b.titulo}>
          <CardHeader title={b.titulo} description={b.desc} />
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{b.titulo.replace("Por ", "")}</th>
                  <th className="text-right">Total</th>
                  {CASO_STATUS.map((s) => <th key={s.value} className="text-right">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.linhas.slice(0, b.limite ?? 999).map((l) => (
                  <tr key={l.chave}>
                    <td className="font-medium">
                      {l.chave.startsWith("(") ? l.chave : <Link href={`/administrativo/processos${qs(f, { [b.param]: l.chave, aba: null })}`} className="hover:text-brand-600">{l.chave}</Link>}
                    </td>
                    <td className="text-right font-bold tabular-nums">{num(l.total)}</td>
                    {CASO_STATUS.map((s) => {
                      const n = l.status[s.value] ?? 0;
                      return <td key={s.value} className={cn("text-right tabular-nums", n ? "" : "text-muted/50")}>{n ? num(n) : "·"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.linhas.length > (b.limite ?? 999) && <p className="px-5 py-3 text-xs text-muted">Mostrando os {b.limite} maiores de {b.linhas.length}. Use os filtros ou exporte o CSV para ver todos.</p>}
        </Card>
      ))}
    </div>
  );
}

function Barra({ rotulo, n, total, href }: { rotulo: string; n: number; total: number; href: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <Link href={href} scroll={false} className="group block">
      <div className="flex justify-between text-sm"><span className="group-hover:text-brand-600">{rotulo}</span><span className="tabular-nums text-muted"><b className="text-fg">{num(n)}</b> · {pct}%</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500" style={{ width: `${pct}%` }} /></div>
    </Link>
  );
}
