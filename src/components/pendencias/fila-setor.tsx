import Link from "next/link";
import { Suspense } from "react";
import { ClipboardList, FileText, Inbox, MessageCircle, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap, pageRange } from "@/lib/data";
import { CASO_PENDENCIAS, CASO_STATUS, FICHA_DESTINOS, FICHA_TIPOS, type FichaTipo } from "@/lib/constants";
import { date, maskDocumento, num, todayISO, whatsappLink } from "@/lib/format";
import { aplicarFiltros, lerFiltros } from "@/lib/casos";
import { abrirFicha } from "@/lib/actions/fichas-pendencia";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

interface CasoFila {
  id: string;
  cliente_id: string;
  tipo: string;
  cidade: string | null;
  uf: string | null;
  recebido_em: string | null;
  pendencia: string | null;
  exigencia_prazo: string | null;
  exigencia_prorrogada: boolean;
  clientes: { id: string; nome: string; documento: string | null; whatsapp: string | null; telefone: string | null };
}

export interface FichaLinha {
  id: string;
  caso_id: string;
  numero: number;
  tipo: FichaTipo;
  status: string;
  destino: string | null;
  destino_status: string | null;
  destino_em: string | null;
  recebida_em: string;
  responsavel_id: string | null;
  encaminhado_para: string | null;
  encerrada_em: string | null;
  clientes: { nome: string; documento: string | null } | null;
  cliente_casos: { tipo: string; status: string; cliente_id: string; protocolo_inss: string | null; situacao_atual: string | null } | null;
}

export const SELECT_FICHA_LINHA =
  "id, caso_id, numero, tipo, status, destino, destino_status, destino_em, recebida_em, responsavel_id, encaminhado_para, encerrada_em, clientes(nome, documento), cliente_casos(tipo, status, cliente_id, protocolo_inss, situacao_atual)";

const TEXTOS: Record<FichaTipo, { titulo: string; descricao: string; fila: string; vazio: string }> = {
  pendencia: {
    titulo: "Pendências dos processos",
    descricao: "Receba o processo, abra a ficha, anote com data o que falta e o retorno do cliente e encaminhe para a análise (Tati) ou a habilitação (Aline).",
    fila: "Processos em pendência",
    vazio: "Quando um processo for para pendência, ele aparece aqui.",
  },
  exigencia: {
    titulo: "Exigências do INSS",
    descricao: "Receba o processo em exigência, abra a ficha, anote o que o INSS exigiu e o retorno do cliente dentro do prazo e encaminhe para a análise (Tati) ou a habilitação (Aline).",
    fila: "Processos em exigência",
    vazio: "Quando um processo for para exigência, ele aparece aqui com o prazo de 7 dias.",
  },
};

/** Fila do setor (Pendências ou Exigências): processos na situação do setor, fichas em andamento e encerradas. */
export async function FilaSetor({ tipo, sp }: { tipo: FichaTipo; sp: Record<string, string | undefined> }) {
  const T = FICHA_TIPOS[tipo];
  const X = TEXTOS[tipo];
  const aba = sp.aba === "encerradas" ? "encerradas" : "fila";
  const f = lerFiltros({ q: sp.q, status: T.status });
  const { page, size, from, to } = pageRange(sp.page, 50);
  const supabase = await createClient();
  const exig = tipo === "exigencia";

  const [fila, { data: abertasData }, { data: encerradasData }, perfis] = await Promise.all([
    aba === "fila"
      ? aplicarFiltros(
          supabase
            .from("cliente_casos")
            .select("id, cliente_id, tipo, cidade, uf, recebido_em, pendencia, exigencia_prazo, exigencia_prorrogada, clientes!inner(id, nome, documento, whatsapp, telefone, excluido_em)", { count: "exact" })
            .order(exig ? "exigencia_prazo" : "recebido_em", { ascending: true, nullsFirst: false })
            .range(from, to),
          f,
        )
      : Promise.resolve({ data: [], count: 0, error: null }),
    supabase.from("fichas_pendencia").select(SELECT_FICHA_LINHA).eq("tipo", tipo).eq("status", "aberta").limit(2000),
    aba === "encerradas"
      ? supabase.from("fichas_pendencia").select(SELECT_FICHA_LINHA).eq("tipo", tipo).eq("status", "encerrada").order("encerrada_em", { ascending: false }).limit(100)
      : Promise.resolve({ data: [] }),
    getProfileMap(),
  ]);
  const casos = (fila.data ?? []) as unknown as CasoFila[];
  const abertas = (abertasData ?? []) as unknown as FichaLinha[];
  const encerradas = (encerradasData ?? []) as unknown as FichaLinha[];
  const fichaDoCaso = new Map(abertas.map((x) => [x.caso_id, x]));
  const nome = (id: string | null) => (id ? (perfis.get(id)?.full_name ?? "—") : "—");
  const hoje = todayISO();
  const vencidas = exig ? casos.filter((c) => c.exigencia_prazo && c.exigencia_prazo < hoje).length : 0;
  const erro = sp.erro === "status" ? `Este processo não está mais em ${exig ? "exigência" : "pendência"}.` : sp.erro ? "Não foi possível abrir a ficha." : null;

  return (
    <>
      <PageHeader
        eyebrow={`Administrativo · ${T.titulo}`}
        title={X.titulo}
        description={X.descricao}
        actions={<LinkButton href="/administrativo/encaminhados" variant="secondary" size="sm"><Send className="h-4 w-4" /> Encaminhados para mim</LinkButton>}
      />
      {erro && <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{erro}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">{X.fila}</p><p className="mt-1 text-xl font-bold tabular-nums">{num(fila.count ?? 0)}</p></div>
        <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">Fichas em andamento</p><p className="mt-1 text-xl font-bold tabular-nums">{num(abertas.length)}</p></div>
        {exig ? (
          <div className={cn("card p-3.5", vencidas && "ring-2 ring-red-500")}><p className="text-[11.5px] font-medium text-muted">Prazo vencido (nesta página)</p><p className={cn("mt-1 text-xl font-bold tabular-nums", vencidas && "text-red-600")}>{num(vencidas)}</p></div>
        ) : (
          <div className="card p-3.5"><p className="text-[11.5px] font-medium text-muted">Sem ficha (nesta página)</p><p className="mt-1 text-xl font-bold tabular-nums">{num(casos.filter((c) => !fichaDoCaso.has(c.id)).length)}</p></div>
        )}
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {[{ k: "fila", l: X.fila }, { k: "encerradas", l: "Fichas encerradas" }].map((t) => (
              <Link key={t.k} href={`${T.rota}${t.k === "fila" ? "" : `?aba=${t.k}`}`} scroll={false}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition", aba === t.k ? "bg-brand-700 text-white" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                {t.l}
              </Link>
            ))}
          </div>
          {aba === "fila" && <Suspense><SearchInput placeholder="Nome ou CPF do cliente…" /></Suspense>}
        </div>

        {aba === "fila" ? (
          fila.error ? <EmptyState title="Não foi possível carregar" description="Tente novamente em instantes." /> :
          casos.length === 0 ? <EmptyState icon={<Inbox className="h-6 w-6" />} title={`Nenhum processo em ${exig ? "exigência" : "pendência"}`} description={f.q ? "Ajuste a busca." : X.vazio} /> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Cliente</th><th>Tipo</th><th>{exig ? "Prazo do INSS" : "Motivo"}</th><th>Recebido</th><th>Ficha</th><th /></tr></thead>
                <tbody>
                  {casos.map((c) => {
                    const ficha = fichaDoCaso.get(c.id);
                    const wa = whatsappLink(c.clientes.whatsapp || c.clientes.telefone);
                    const vencido = !!c.exigencia_prazo && c.exigencia_prazo < hoje;
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/clientes/${c.cliente_id}`} className="font-semibold hover:text-brand-600">{c.clientes.nome}</Link>
                          <div className="text-xs text-muted">{c.clientes.documento ? maskDocumento(c.clientes.documento) : "sem CPF"}{c.cidade ? ` · ${c.cidade}${c.uf ? `/${c.uf}` : ""}` : ""}</div>
                        </td>
                        <td className="whitespace-nowrap text-sm">{c.tipo}</td>
                        <td>
                          {exig ? (
                            c.exigencia_prazo ? <span className={cn("whitespace-nowrap text-sm font-semibold", vencido ? "text-red-600" : "")}>{date(c.exigencia_prazo)}{vencido ? " · vencido" : ""}{c.exigencia_prorrogada ? <span className="block text-[11px] font-normal text-muted">prorrogado</span> : null}</span> : <span className="text-xs text-muted">—</span>
                          ) : c.pendencia ? <Badge tone="amber">{optionLabel(CASO_PENDENCIAS, c.pendencia)}</Badge> : <span className="text-xs text-muted">—</span>}
                        </td>
                        <td className="whitespace-nowrap text-xs text-muted">{c.recebido_em ? date(c.recebido_em) : "—"}</td>
                        <td className="text-sm">
                          {ficha ? <span>Nº {ficha.numero} · {nome(ficha.responsavel_id)}<div className="text-[11px] text-muted">desde {date(ficha.recebida_em)}</div></span> : <span className="text-xs text-muted">Sem ficha</span>}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <form action={abrirFicha}>
                              <input type="hidden" name="caso_id" value={c.id} />
                              <input type="hidden" name="tipo" value={tipo} />
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
        ) : !encerradas.length ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="Nenhuma ficha encerrada" />
        ) : (
          <TabelaFichas linhas={encerradas} nome={nome} />
        )}
        {aba === "fila" && <Suspense><Pagination page={page} pageSize={size} total={fila.count ?? 0} /></Suspense>}
      </Card>
      <p className="mt-3 text-xs text-muted">Cada processo tem no máximo uma ficha aberta por setor; ao encerrar, a ficha fica assinada e não muda mais.</p>
    </>
  );
}

/** Lista de fichas encerradas (setor ou encaminhados). */
export function TabelaFichas({ linhas, nome, acao }: { linhas: FichaLinha[]; nome: (id: string | null) => string; acao?: (x: FichaLinha) => React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead><tr><th>Cliente</th><th>Ficha</th><th>Destino</th><th>Responsável</th><th>Encaminhado a</th><th>Encerrada</th><th>Situação hoje</th></tr></thead>
        <tbody>
          {linhas.map((x) => (
            <tr key={x.id}>
              <td><Link href={`/administrativo/pendencias/${x.id}`} className="font-semibold hover:text-brand-600">{x.clientes?.nome ?? "—"}</Link><div className="text-xs text-muted">{x.cliente_casos?.tipo}</div></td>
              <td className="whitespace-nowrap text-sm">{x.tipo === "exigencia" ? "Exigências" : "Pendências"} nº {x.numero}</td>
              <td><Badge tone={FICHA_DESTINOS.find((d) => d.value === x.destino)?.tone ?? "slate"}>{optionLabel(FICHA_DESTINOS, x.destino ?? "")}</Badge></td>
              <td className="text-sm">{nome(x.responsavel_id)}</td>
              <td className="text-sm">{x.encaminhado_para ? nome(x.encaminhado_para) : "—"}</td>
              <td className="whitespace-nowrap text-xs text-muted">{x.encerrada_em ? date(x.encerrada_em) : "—"}</td>
              <td className="text-sm">{acao ? acao(x) : optionLabel(CASO_STATUS, x.cliente_casos?.status ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
