import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, ClipboardList, Download, FolderSearch, List, MessageCircle } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { pageRange } from "@/lib/data";
import { CASO_PENDENCIAS, CASO_STATUS, CASO_STATUS_RESTRITOS, type Option } from "@/lib/constants";
import { date, maskDocumento, num, whatsappLink } from "@/lib/format";
import { aplicarFiltros, argsResumo, lerFiltros, qs, SELECT_CASOS, type FiltrosCasos, type LinhaResumo, type ResumoCasos } from "@/lib/casos";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { StatusCasoSelect } from "@/components/clientes/status-caso-select";
import { ExigenciaPrazo } from "@/components/processos/exigencia-prazo";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { editarCaso } from "@/lib/actions/comercial";
import { CASO_FIELDS } from "@/components/processos/caso-fields";
import { abrirFicha } from "@/lib/actions/fichas-pendencia";
import { DossieButton } from "@/components/dossie/dossie-button";

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
  exigencia_estado: string | null;
  corretor_principal: string | null;
  pericia_em: string | null;
  avaliacao_em: string | null;
  status: string;
  pendencia: string | null;
  exigencia_prazo: string | null;
  exigencia_prorrogada: boolean;
  protocolo_inss: string | null;
  situacao_atual: string | null;
  assessores: { nome: string } | { nome: string }[] | null;
  situacao_planilha: string | null;
  observacoes: string | null;
  clientes: { id: string; nome: string; documento: string | null; whatsapp: string | null; telefone: string | null };
}

const TONS: Record<string, string> = {
  em_analise: "bg-sky-500", pendencia: "bg-amber-500", exigencia: "bg-red-500", habilitado: "bg-emerald-500",
  habilitacao: "bg-accent-500",
  deferido: "bg-green-600", indeferido: "bg-rose-600", aguardando_idade: "bg-brand-500", judicializado: "bg-violet-500",
  arquivo_morto: "bg-slate-400", outros: "bg-slate-300",
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
  const vazio = { habilitados: 0, exigencia_aberta: 0, exigencia_cumprida: 0, sem_assinatura: 0, pericia_agendada: 0, arquivo_morto: 0 };
  const resumo = (resumoData ?? { total: 0, clientes: 0, por_status: {}, indicadores: vazio, por_tipo: [], por_corretor: [], por_cidade: [], por_ano: {}, por_pendencia: {}, sem_assinatura: 0 }) as ResumoCasos;
  const op = (opcoesData ?? { tipos: [], cidades: [], corretores: [], anos: [] }) as { tipos: string[]; cidades: string[]; corretores: { nome: string; n: number }[]; anos: number[] };
  const opcoes = (xs: (string | number)[]): Option[] => xs.map((x) => ({ value: String(x), label: String(x) }));
  const consultores: Option[] = op.corretores.map((c) => ({ value: c.nome, label: `${c.nome} (${c.n})` }));
  const filtrando = !!(f.q || f.status || f.tipo || f.corretor || f.cidade || f.ano || f.pendencia || f.habilitado !== null || f.exigencia || f.assinaturas);
  const ind = resumo.indicadores ?? vazio;
  const podeRestritos = can(profile, "processos.status_restritos");
  const podeEditar = can(profile, "clientes.write");
  const statusVisiveis = CASO_STATUS.filter((s) => podeRestritos || !(CASO_STATUS_RESTRITOS as readonly string[]).includes(s.value));
  const sufAba = aba === "relatorios" ? "&aba=relatorios" : "";
  const indicadores = [
    { l: "Habilitados (data de habilitação)", n: ind.habilitados, extra: { habilitado: f.habilitado === true ? null : "sim" }, on: f.habilitado === true },
    { l: "Exigências cumpridas", n: ind.exigencia_cumprida, extra: { exigencia: f.exigencia === "cumprida" ? null : "cumprida" }, on: f.exigencia === "cumprida" },
    { l: "Exigências em aberto", n: ind.exigencia_aberta, extra: { exigencia: f.exigencia === "aberta" ? null : "aberta" }, on: f.exigencia === "aberta" },
    { l: "Sem contrato ou procuração", n: ind.sem_assinatura, extra: { assinaturas: f.assinaturas === "faltando" ? null : "faltando" }, on: f.assinaturas === "faltando" },
    { l: "Perícia / avaliação agendada", n: ind.pericia_agendada, extra: { status: null }, on: false },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Administrativo"
        title="Processos dos clientes"
        description="Todos os processos (benefícios) da base, com a situação de cada um. Filtre por assessor, cidade, tipo e situação; veja os relatórios ou exporte."
        actions={can(profile, "clientes.exportar") && (
          <LinkButton href={`/api/casos/exportar${qs(f)}`} variant="secondary" prefetch={false}>
            <Download className="h-4 w-4" /> Exportar planilha
          </LinkButton>
        )}
      />

      {/* situação: cartões clicáveis (filtram a lista) */}
      <div className="stagger mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {statusVisiveis.map((s) => {
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

      <p className="-mt-3 mb-3 text-xs text-muted">Situação principal: cada processo conta uma vez e é definida pela equipe (troque na lista).{podeRestritos ? "" : " Processos em análise, pendência ou exigência só aparecem para os funcionários autorizados."} Os indicadores abaixo vêm das colunas da planilha e podem se sobrepor.</p>
      <div className="mb-6 flex flex-wrap gap-2">
        {indicadores.map((i) => (
          <Link key={i.l} href={`/administrativo/processos${qs(f, { ...i.extra, page: null })}${sufAba}`} scroll={false}
            className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition hover:border-brand-300", i.on ? "border-accent-500 bg-accent-50 text-accent-800 dark:bg-accent-900/30 dark:text-accent-100" : "border-line bg-surface")}>
            <b className="tabular-nums">{num(i.n)}</b> <span className="text-muted">{i.l}</span>
          </Link>
        ))}
      </div>

      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <Suspense>
            <SearchInput placeholder="Nome (com ou sem acento) ou CPF…" />
            <FilterSelect param="status" options={statusVisiveis} allLabel="Toda situação" />
            <FilterSelect param="tipo" options={opcoes(op.tipos)} allLabel="Todos os tipos" />
            <FilterSelect param="corretor" options={consultores} allLabel="Todos os assessores" />
            <FilterSelect param="papel" options={[{ value: "principal", label: "Só como assessor principal" }]} allLabel="Assessor principal ou parceiro" />
            <FilterSelect param="cidade" options={opcoes(op.cidades)} allLabel="Todas as cidades" />
            <FilterSelect param="ano" options={opcoes(op.anos)} allLabel="Todos os anos" />
            <FilterSelect param="pendencia" options={CASO_PENDENCIAS} allLabel="Qualquer pendência" />
            <FilterSelect param="habilitado" options={[{ value: "sim", label: "Com data de habilitação" }, { value: "nao", label: "Sem data de habilitação" }]} allLabel="Habilitação" />
            <FilterSelect param="exigencia" options={[{ value: "aberta", label: "Exigência em aberto" }, { value: "cumprida", label: "Exigência cumprida" }, { value: "nenhuma", label: "Sem exigência" }]} allLabel="Exigência" />
            <FilterSelect param="assinaturas" options={[{ value: "faltando", label: "Falta contrato ou procuração" }, { value: "completas", label: "Contrato e procuração assinados" }]} allLabel="Assinaturas" />
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
                  <tr><th>Cliente</th><th>Tipo</th><th>Assessor</th><th>Cidade</th><th>Recebido</th><th>Habilitado</th><th>Situação</th><th /></tr>
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
                        <td className="text-sm">{(Array.isArray(c.assessores) ? c.assessores[0]?.nome : c.assessores?.nome) ?? c.corretor ?? "—"}{c.corretor && (Array.isArray(c.assessores) ? c.assessores[0] : c.assessores) ? <div className="text-[11px] text-muted">planilha: {c.corretor}</div> : c.corretor?.includes("/") ? <div className="text-[11px] text-muted">principal: {c.corretor_principal}</div> : null}</td>
                        <td className="whitespace-nowrap text-sm">{c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{c.recebido_em ? date(c.recebido_em) : "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{c.habilitado_em ? date(c.habilitado_em) : "—"}</td>
                        <td>
                          <div className="flex flex-wrap items-center gap-1">
                            {podeEditar ? <StatusCasoSelect casoId={c.id} status={c.status} podeRestritos={podeRestritos} protocolo={c.protocolo_inss} situacao={c.situacao_atual} /> : <StatusBadge options={CASO_STATUS} value={c.status} />}
                            {c.status === "exigencia" && <ExigenciaPrazo casoId={c.id} prazo={c.exigencia_prazo} prorrogada={c.exigencia_prorrogada} podeProrrogar={podeEditar} />}
                            {c.pendencia && <Badge tone="amber">{optionLabel(CASO_PENDENCIAS, c.pendencia)}</Badge>}
                            {c.exigencia_estado === "cumprida" && <Badge tone="green">exigência cumprida</Badge>}
                            {c.exigencia_estado === "aberta" && <Badge tone="red">exigência em aberto</Badge>}
                            {c.habilitado_em && c.status !== "habilitado" && <Badge tone="green">habilitado</Badge>}
                          </div>
                          {(c.protocolo_inss || c.situacao_atual) && <div className="mt-1 max-w-xs text-xs text-muted">{c.protocolo_inss ? <>Protocolo <b className="text-fg">{c.protocolo_inss}</b></> : null}{c.protocolo_inss && c.situacao_atual ? " · " : ""}{c.situacao_atual}</div>}
                          {c.status === "habilitado" && !c.protocolo_inss && <div className="mt-1 text-xs font-semibold text-red-600">Habilitado sem protocolo do INSS</div>}
                          {c.observacoes && <div className="mt-1 max-w-xs truncate text-xs text-muted" title={c.observacoes}>{c.observacoes}</div>}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                          {podeEditar && ((c.status === "pendencia" && can(profile, "fichas.pendencias")) || (c.status === "exigencia" && can(profile, "fichas.exigencias"))) && (
                            <form action={abrirFicha}>
                              <input type="hidden" name="caso_id" value={c.id} />
                              <input type="hidden" name="tipo" value={c.status} />
                              <button type="submit" title={`Ficha de acompanhamento de ${c.status === "exigencia" ? "exigências" : "pendências"}`} aria-label={`Ficha de ${c.status === "exigencia" ? "exigências" : "pendências"} de ${c.clientes.nome}`} className="grid h-8 w-8 place-items-center rounded-lg text-amber-700 transition hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40">
                                <ClipboardList className="h-4 w-4" />
                              </button>
                            </form>
                          )}
                          <DossieButton casoId={c.id} cliente={c.clientes.nome} tipo={c.tipo} compacto />
                          {podeEditar && <FormDrawerButton action={editarCaso} fields={CASO_FIELDS} values={{ protocolo_inss: c.protocolo_inss, situacao_atual: c.situacao_atual, observacoes: c.observacoes }} hidden={{ id: c.id }} title="Editar processo" description={`${c.clientes.nome} · ${c.tipo}`} icon="edit" variant="ghost" size="icon" width="max-w-lg" />}
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" title="Conversar no WhatsApp" aria-label={`WhatsApp de ${c.clientes.nome}`} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-700">
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Relatorios resumo={resumo} f={f} statusVisiveis={statusVisiveis} />
        )}
        {aba === "lista" && <Suspense><Pagination page={page} pageSize={size} total={count ?? 0} /></Suspense>}
      </Card>
    </>
  );
}

/** Tabelas cruzadas (dimensão × situação). Cada linha leva à lista filtrada. */
function Relatorios({ resumo, f, statusVisiveis }: { resumo: ResumoCasos; f: FiltrosCasos; statusVisiveis: Option[] }) {
  const blocos: { titulo: string; desc: string; linhas: LinhaResumo[]; param: keyof FiltrosCasos; limite?: number }[] = [
    { titulo: "Por tipo de processo", desc: "Quantidade e situação de cada tipo de benefício", linhas: resumo.por_tipo, param: "tipo" },
    { titulo: "Por assessor / corretor", desc: "Total = processos em que o assessor aparece (sozinho ou com parceiro, ex.: \"Mamedio/Jose\"); Como principal = o 1º nome do campo", linhas: resumo.por_corretor, param: "corretor", limite: 70 },
    { titulo: "Por cidade", desc: "Onde estão os processos", linhas: resumo.por_cidade, param: "cidade", limite: 70 },
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
                  {b.param === "corretor" && <th className="text-right">Como principal</th>}
                  {statusVisiveis.map((s) => <th key={s.value} className="text-right">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.linhas.slice(0, b.limite ?? 999).map((l) => (
                  <tr key={l.chave}>
                    <td className="font-medium">
                      {l.chave.startsWith("(") ? l.chave : <Link href={`/administrativo/processos${qs(f, { [b.param]: l.chave, aba: null })}`} className="hover:text-brand-600">{l.chave}</Link>}
                    </td>
                    <td className="text-right font-bold tabular-nums">{num(l.total)}</td>
                    {b.param === "corretor" && <td className="text-right tabular-nums">{num(l.principal ?? 0)}</td>}
                    {statusVisiveis.map((s) => {
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
