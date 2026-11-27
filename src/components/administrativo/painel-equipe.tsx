import Link from "next/link";
import { ArrowRight, History, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap } from "@/lib/data";
import { CASO_STATUS, ROLES } from "@/lib/constants";
import { dateTime, num, relative, todayISO } from "@/lib/format";
import { feriadosNacionais } from "@/lib/juridico/prazos";
import { addDays, currentMonth, firstDay, lastDay, spStartOf, spDateOf } from "@/components/dashboard/periods";
import { carregarEquipe, INDICADOR_ROTULO, totalAcoes, type LinhaEquipe } from "@/lib/equipe";
import { cn } from "@/lib/cn";
import { Card, CardHeader } from "@/components/ui/card";
import { optionLabel } from "@/components/ui/badge";

type Ref<T> = T | T[] | null;
const um = <T,>(r: Ref<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
interface Mov { id: string; de: string | null; para: string; em: string; usuario_id: string; cliente_casos: Ref<{ tipo: string; cliente_id: string; clientes: Ref<{ nome: string }> }> }

const SETOR_IND: Record<string, { setor: string; cor: string; corTexto: string }> = {
  analises: { setor: "Análise", cor: "bg-sky-500", corTexto: "text-sky-600" },
  pendencias_resolvidas: { setor: "Pendências", cor: "bg-amber-500", corTexto: "text-amber-600" },
  exigencias_cumpridas: { setor: "Exigências", cor: "bg-red-500", corTexto: "text-red-600" },
  habilitados: { setor: "Habilitação", cor: "bg-accent-500", corTexto: "text-accent-600" },
};
const OUTRAS = ["bg-brand-500", "bg-violet-500", "bg-emerald-500", "bg-slate-400"];
const linkCls = "text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300";

/** Dias úteis (seg–sex, sem feriados nacionais) do mês e quantos já passaram até hoje. */
function diasUteis(mes: string, hoje: string) {
  const feriados = feriadosNacionais(Number(mes.slice(0, 4)));
  let total = 0, passados = 0;
  for (let d = firstDay(mes); d <= lastDay(mes); d = addDays(d, 1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6 || feriados.has(d)) continue;
    total++;
    if (d <= hoje) passados++;
  }
  return { total, passados };
}

/** Painel administrativo, parte 2: metas individuais, ritmo e movimentações da equipe interna. */
export async function PainelEquipe() {
  const hoje = todayISO();
  const mes = currentMonth();
  const ini14 = addDays(hoje, -13);
  const supabase = await createClient();
  const [equipe, { data: movs }, { data: filaHab }, profiles] = await Promise.all([
    carregarEquipe(firstDay(mes), hoje),
    supabase.from("cliente_casos_historico").select("id, de, para, em, usuario_id, cliente_casos(tipo, cliente_id, clientes(nome))").not("usuario_id", "is", null).gte("em", spStartOf(ini14)).order("em", { ascending: false }).limit(1000),
    supabase.from("cliente_casos").select("id", { count: "exact", head: true }).eq("status", "habilitacao").then((r) => ({ data: r.count ?? 0 })),
    getProfileMap(),
  ]);
  const { total: uteis, passados } = diasUteis(mes, hoje);

  // quem aparece nos cartões: quem tem meta individual, quem habilita (comercial listado) ou quem movimentou algo
  const pessoas = equipe
    .filter((l) => Object.keys(l.metas).some((k) => k in SETOR_IND) || l.papel === "consultor" || totalAcoes(l) > 0)
    .map((l, i) => {
      const ind = Object.keys(l.metas).find((k) => k in SETOR_IND) ?? (l.papel === "consultor" ? "habilitados" : null);
      const s = ind ? SETOR_IND[ind] : null;
      return { l, ind, setor: s?.setor ?? optionLabel(ROLES, l.papel), cor: s?.cor ?? OUTRAS[i % OUTRAS.length] };
    })
    .sort((a, b) => (a.ind ? Object.keys(SETOR_IND).indexOf(a.ind) : 9) - (b.ind ? Object.keys(SETOR_IND).indexOf(b.ind) : 9));
  const corDe = new Map(pessoas.map((p) => [p.l.usuario_id, p.cor]));

  const lista = (movs ?? []) as unknown as Mov[];
  const dias = Array.from({ length: 14 }, (_, i) => addDays(ini14, i));
  const porDia = dias.map((d) => {
    const doDia = lista.filter((m) => spDateOf(m.em) === d);
    const porPessoa = new Map<string, number>();
    for (const m of doDia) porPessoa.set(m.usuario_id, (porPessoa.get(m.usuario_id) ?? 0) + 1);
    return { d, total: doDia.length, porPessoa };
  });
  const maxDia = Math.max(1, ...porDia.map((x) => x.total));
  const nomeDe = (id: string) => profiles.get(id)?.full_name ?? "Usuário";

  return (
    <>
      {pessoas.length === 0 ? (
        <Card className="p-5 text-sm text-muted">Nenhuma pessoa da equipe com meta ou movimentação neste mês.</Card>
      ) : (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {pessoas.map(({ l, ind, setor, cor }) => <CartaoPessoa key={l.usuario_id} l={l} ind={ind} setor={setor} cor={cor} uteis={uteis} passados={passados} filaHab={filaHab ?? 0} />)}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={<Users className="h-4 w-4" />} title="Movimentações por dia" description="Mudanças de status feitas por cada pessoa · últimos 14 dias" />
          <div className="p-5">
            <div className="flex h-36 items-end gap-1.5 border-b border-line" role="img" aria-label="Mudanças de status por dia nos últimos 14 dias">
              {porDia.map((x) => (
                <div key={x.d} className="flex flex-1 flex-col-reverse" title={`${x.d.split("-").reverse().slice(0, 2).join("/")}: ${x.total} mudança(s)`}>
                  {x.total === 0 ? <span className="block h-0.5 rounded-t bg-line" /> : [...x.porPessoa.entries()].map(([u, n]) => (
                    <span key={u} className={cn("block rounded-t-sm", corDe.get(u) ?? "bg-slate-400")} style={{ height: `${(n / maxDia) * 128}px` }} />
                  ))}
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5">{porDia.map((x) => <span key={x.d} className="flex-1 text-center text-[10px] tabular-nums text-muted">{x.d.slice(8)}</span>)}</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {pessoas.map((p) => <span key={p.l.usuario_id} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", p.cor)} />{p.l.nome}</span>)}
            </div>
            {lista.length === 0 && (
              <p className="mt-4 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                Nenhuma mudança de status registrada pela equipe nos últimos 14 dias. As barras sobem conforme cada pessoa muda o status dos processos no sistema.
              </p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<History className="h-4 w-4" />} title="Últimas movimentações da equipe" action={<Link href="/relatorios/equipe" className={linkCls}>Relatório da equipe</Link>} />
          {lista.length === 0 ? (
            <p className="m-5 rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">
              Ainda não há movimentações. Aqui aparece quem mudou o status, de qual cliente, de qual status para qual e quando.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {lista.slice(0, 12).map((m) => {
                const caso = um(m.cliente_casos);
                return (
                  <li key={m.id} className="px-5 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      {caso ? <Link href={`/clientes/${caso.cliente_id}`} className="min-w-0 truncate text-sm font-medium hover:text-brand-600">{um(caso.clientes)?.nome ?? "Cliente"}</Link> : <span className="text-sm">Processo</span>}
                      <span className="shrink-0 text-[11px] text-muted" title={dateTime(m.em)}>{relative(m.em)}</span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                      <span className={cn("h-2 w-2 rounded-full", corDe.get(m.usuario_id) ?? "bg-slate-400")} />
                      {nomeDe(m.usuario_id)} · {caso?.tipo} · {m.de ? optionLabel(CASO_STATUS, m.de) : "novo"} <ArrowRight className="h-3 w-3" /> <b className="text-fg">{optionLabel(CASO_STATUS, m.para)}</b>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function CartaoPessoa({ l, ind, setor, cor, uteis, passados, filaHab }: { l: LinhaEquipe; ind: string | null; setor: string; cor: string; uteis: number; passados: number; filaHab: number }) {
  const meta = ind ? (l.metas[ind] ?? null) : null;
  const feito = ind ? Number((l as unknown as Record<string, number>)[ind] ?? 0) : 0;
  const esperado = meta ? Math.round((meta * passados) / Math.max(1, uteis)) : null;
  const marca = uteis ? (passados / uteis) * 100 : 0;
  const parado = totalAcoes(l) === 0 && !feito;
  const situacao = meta
    ? feito >= meta ? { txt: "Meta batida", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" }
      : feito >= (esperado ?? 0) ? { txt: `No ritmo · faltam ${num(meta - feito)}`, cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" }
      : { txt: `Abaixo do ritmo · faltam ${num(meta - feito)}`, cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200" }
    : parado ? { txt: "Sem movimentações no mês", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-100" } : null;
  const mini: [number, string][] = ind === "analises" ? [[l.trocas_status - l.analises, "outras mudanças"], [l.enviados_habilitacao, "p/ habilitação"], [l.resumos, "resumos"]]
    : ind === "habilitados" ? [[filaHab, "na fila"], [l.dossies, "dossiês"], [l.resumos, "resumos"]]
    : [[l.fichas_abertas, "fichas abertas"], [l.fichas_encerradas, "encerradas"], [l.resumos, l.processos_trabalhados ? `resumos · ${l.processos_trabalhados} proc.` : "resumos"]];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-extrabold text-white", cor)}>{l.nome.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{l.nome}</p>
          <p className="truncate text-xs text-muted">{setor} · {l.ultimo_acesso ? `último acesso ${dateTime(l.ultimo_acesso)}` : "nunca entrou"}</p>
        </div>
      </div>
      <p className="mt-4 flex items-baseline gap-1.5"><span className="text-3xl font-extrabold tabular-nums">{num(feito)}</span><span className="text-sm text-muted">{meta ? `de ${num(meta)} ${INDICADOR_ROTULO[ind!]}` : ind ? `${INDICADOR_ROTULO[ind]} no mês` : "mudanças de status no mês"}</span></p>
      <div className="relative mt-2 h-2.5 rounded-full bg-surface-2">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", cor)} style={{ width: `${meta ? Math.min(100, (feito / Math.max(1, meta)) * 100) : 0}%` }} />
        {meta ? <span className="absolute -inset-y-1 w-0.5 bg-accent-500" style={{ left: `${marca}%` }} title="Onde deveria estar hoje" /> : null}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{meta ? `${Math.round((feito / Math.max(1, meta)) * 100)}%` : "sem meta individual"}</span>
        <span>{esperado != null ? `esperado até hoje: ${num(esperado)}` : ""}</span>
      </div>
      {situacao && <span className={cn("mt-2.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold", situacao.cls)}>{situacao.txt}</span>}
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {mini.map(([n, r]) => <div key={r} className="rounded-lg bg-surface-2 px-1 py-1.5 text-center"><b className="block tabular-nums">{num(Math.max(0, n))}</b><span className="text-[10.5px] leading-tight text-muted">{r}</span></div>)}
      </div>
    </Card>
  );
}
