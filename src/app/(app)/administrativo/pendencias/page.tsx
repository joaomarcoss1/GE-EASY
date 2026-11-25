import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardList, FileText, Inbox, MessageCircle } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap, pageRange } from "@/lib/data";
import { CASO_PENDENCIAS, CASO_STATUS, FICHA_DESTINOS } from "@/lib/constants";
import { date, maskDocumento, num, whatsappLink } from "@/lib/format";
import { aplicarFiltros, lerFiltros } from "@/lib/casos";
import { abrirFicha } from "@/lib/actions/fichas-pendencia";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, SearchInput } from "@/components/ui/filters";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Pendências" };

interface CasoFila {
  id: string;
  cliente_id: string;
  tipo: string;
  cidade: string | null;
  uf: string | null;
  recebido_em: string | null;
  pendencia: string | null;
  clientes: { id: string; nome: string; documento: string | null; whatsapp: string | null; telefone: string | null };
}

interface FichaLinha {
  id: string;
  caso_id: string;
  numero: number;
  status: string;
  destino: string | null;
  destino_status: string | null;
  destino_em: string | null;
  recebida_em: string;
  responsavel_id: string | null;
  encaminhado_para: string | null;
  encerrada_em: string | null;
  clientes: { nome: string; documento: string | null } | null;
  cliente_casos: { tipo: string; status: string } | null;
}

/**
 * Setor de Pendências: processos em pendência, com a Folha de Acompanhamento de cada um. Quem cuida da pendência
 * abre a ficha, registra o que falta e o retorno do cliente e encaminha (em geral para a análise).
 */
export default async function PendenciasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { userId } = await requirePermission("processos.status_restritos");
  const sp = await searchParams;
  const aba = sp.aba === "encerradas" ? "encerradas" : sp.aba === "recebidos" ? "recebidos" : "fila";
  const f = lerFiltros({ q: sp.q, status: "pendencia" });
  const { page, size, from, to } = pageRange(sp.page, 50);
  const supabase = await createClient();

  const [fila, { data: abertasData }, { data: encerradasData }, { data: recebidosData }, perfis] = await Promise.all([
    aba === "fila"
      ? aplicarFiltros(
          supabase.from("cliente_casos").select("id, cliente_id, tipo, cidade, uf, recebido_em, pendencia, clientes!inner(id, nome, documento, whatsapp, telefone, excluido_em)", { count: "exact" })
            .order("recebido_em", { ascending: true, nullsFirst: false }).range(from, to),
          f,
        )
      : Promise.resolve({ data: [], count: 0, error: null }),
    supabase.from("fichas_pendencia").select("id, caso_id, numero, status, destino, destino_status, destino_em, recebida_em, responsavel_id, encaminhado_para, encerrada_em, clientes(nome, documento), cliente_casos(tipo, status)").eq("status", "aberta").limit(2000),
    aba === "encerradas"
      ? supabase.from("fichas_pendencia").select("id, caso_id, numero, status, destino, destino_status, destino_em, recebida_em, responsavel_id, encaminhado_para, encerrada_em, clientes(nome, documento), cliente_casos(tipo, status)").eq("status", "encerrada").order("encerrada_em", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    supabase.from("fichas_pendencia").select("id, caso_id, numero, status, destino, destino_status, destino_em, recebida_em, responsavel_id, encaminhado_para, encerrada_em, clientes(nome, documento), cliente_casos(tipo, status)").eq("status", "encerrada").eq("encaminhado_para", userId).order("encerrada_em", { ascending: false }).limit(200),
    getProfileMap(),
  ]);
  const casos = (fila.data ?? []) as unknown as CasoFila[];
  const abertas = (abertasData ?? []) as unknown as FichaLinha[];
  const encerradas = (encerradasData ?? []) as unknown as FichaLinha[];
  // "Recebidos": encaminhados para mim que ainda estão em análise
  const recebidos = ((recebidosData ?? []) as unknown as FichaLinha[]).filter((x) => x.cliente_casos?.status === "em_analise");
  const fichaDoCaso = new Map(abertas.map((x) => [x.caso_id, x]));
  const nome = (id: string | null) => (id ? (perfis.get(id)?.full_name ?? "—") : "—");
  const semFicha = casos.filter((c) => !fichaDoCaso.has(c.id)).length;

  const abas = [
    { k: "fila", l: "Processos em pendência", n: fila.count ?? null },
    { k: "recebidos", l: "Enviados para mim", n: recebidos.length },
    { k: "encerradas", l: "Fichas encerradas", n: null },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Administrativo · Pendências"
        title="Pendências dos processos"
        description="Receba o processo, abra a Folha de Acompanhamento, anote com data o que falta e o retorno do cliente e encaminhe para a análise."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">Em pendência</p><p className="mt-1 text-xl font-bold tabular-nums">{num(fila.count ?? 0)}</p></div>
        <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">Fichas em andamento</p><p className="mt-1 text-xl font-bold tabular-nums">{num(abertas.length)}</p></div>
        <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">Sem ficha (nesta página)</p><p className="mt-1 text-xl font-bold tabular-nums">{num(semFicha)}</p></div>
        <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">Enviados para mim</p><p className="mt-1 text-xl font-bold tabular-nums">{num(recebidos.length)}</p></div>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {abas.map((t) => (
              <Link key={t.k} href={`/administrativo/pendencias${t.k === "fila" ? "" : `?aba=${t.k}`}`} scroll={false}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition", aba === t.k ? "bg-brand-700 text-white" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                {t.l}{t.n !== null && t.n > 0 ? <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{t.n}</span> : null}
              </Link>
            ))}
          </div>
          {aba === "fila" && <Suspense><SearchInput placeholder="Nome ou CPF do cliente…" /></Suspense>}
        </div>

        {aba === "fila" && (
          fila.error ? <EmptyState title="Não foi possível carregar" description="Tente novamente em instantes." /> :
          casos.length === 0 ? <EmptyState icon={<Inbox className="h-6 w-6" />} title="Nenhum processo em pendência" description={f.q ? "Ajuste a busca." : "Quando um processo for para pendência, ele aparece aqui."} /> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Cliente</th><th>Tipo</th><th>Motivo</th><th>Recebido</th><th>Ficha</th><th /></tr></thead>
                <tbody>
                  {casos.map((c) => {
                    const ficha = fichaDoCaso.get(c.id);
                    const wa = whatsappLink(c.clientes.whatsapp || c.clientes.telefone);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/clientes/${c.cliente_id}`} className="font-semibold hover:text-brand-600">{c.clientes.nome}</Link>
                          <div className="text-xs text-muted">{c.clientes.documento ? maskDocumento(c.clientes.documento) : "sem CPF"}{c.cidade ? ` · ${c.cidade}${c.uf ? `/${c.uf}` : ""}` : ""}</div>
                        </td>
                        <td className="whitespace-nowrap text-sm">{c.tipo}</td>
                        <td>{c.pendencia ? <Badge tone="amber">{optionLabel(CASO_PENDENCIAS, c.pendencia)}</Badge> : <span className="text-xs text-muted">—</span>}</td>
                        <td className="whitespace-nowrap text-xs text-muted">{c.recebido_em ? date(c.recebido_em) : "—"}</td>
                        <td className="text-sm">
                          {ficha ? <span>Nº {ficha.numero} · {nome(ficha.responsavel_id)}<div className="text-[11px] text-muted">desde {date(ficha.recebida_em)}</div></span> : <span className="text-xs text-muted">Sem ficha</span>}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <form action={abrirFicha}>
                              <input type="hidden" name="caso_id" value={c.id} />
                              <button type="submit" className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", ficha ? "border border-line hover:bg-surface-2" : "bg-brand-700 text-white hover:bg-brand-800")}>
                                <ClipboardList className="h-3.5 w-3.5" /> {ficha ? "Continuar ficha" : "Abrir ficha"}
                              </button>
                            </form>
                            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp de ${c.clientes.nome}`} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" /></a>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {aba !== "fila" && (() => {
          const lista = aba === "recebidos" ? recebidos : encerradas;
          if (!lista.length) return <EmptyState icon={<FileText className="h-6 w-6" />} title={aba === "recebidos" ? "Nada enviado para você" : "Nenhuma ficha encerrada"} description={aba === "recebidos" ? "Os processos que o setor de Pendências encaminhar para você aparecem aqui." : undefined} />;
          return (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Cliente</th><th>Ficha</th><th>Destino</th><th>Responsável</th><th>Encaminhado a</th><th>Encerrada</th><th>Situação hoje</th></tr></thead>
                <tbody>
                  {lista.map((x) => (
                    <tr key={x.id}>
                      <td><Link href={`/administrativo/pendencias/${x.id}`} className="font-semibold hover:text-brand-600">{x.clientes?.nome ?? "—"}</Link><div className="text-xs text-muted">{x.cliente_casos?.tipo}</div></td>
                      <td className="text-sm">Nº {x.numero}</td>
                      <td><Badge tone={(FICHA_DESTINOS.find((d) => d.value === x.destino)?.tone ?? "slate")}>{optionLabel(FICHA_DESTINOS, x.destino ?? "")}</Badge></td>
                      <td className="text-sm">{nome(x.responsavel_id)}</td>
                      <td className="text-sm">{x.encaminhado_para ? nome(x.encaminhado_para) : "—"}</td>
                      <td className="whitespace-nowrap text-xs text-muted">{x.encerrada_em ? date(x.encerrada_em) : "—"}</td>
                      <td className="text-sm">{optionLabel(CASO_STATUS, x.cliente_casos?.status ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
        {aba === "fila" && <Suspense><Pagination page={page} pageSize={size} total={fila.count ?? 0} /></Suspense>}
      </Card>
      <p className="mt-3 text-xs text-muted">Cada processo tem no máximo uma ficha aberta; ao encerrar, a ficha fica assinada e não muda mais.</p>
    </>
  );
}
