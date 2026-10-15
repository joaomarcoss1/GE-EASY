import "server-only";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Briefcase, CalendarClock, Landmark, ListChecks, Receipt, ShieldCheck, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EVENTO_TIPOS, PRIORIDADES } from "@/lib/constants";
import { brl, brlShort, date, daysUntil, num, time, todayISO } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, currentMonth, firstDay, lastDay, monthLong, spDateOf, spStartOf, sum, TZ } from "@/components/dashboard/periods";

type Num = number | string;

export function greeting() {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function todayLong() {
  const s = new Date().toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const linkCls = "text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300";

// ---------------------------------------------------------------------- Comercial (resumo)

/** Resumo comercial do mês (crédito vendido + prêmios). Só renderize se can(role, "comercial.view"). */
export async function ComercialResumoCard({ compact = false }: { compact?: boolean }) {
  const supabase = await createClient();
  const mes = currentMonth();
  const [de, ate] = [firstDay(mes), lastDay(mes)];
  const [cotas, apolices] = await Promise.all([
    fetchAll<{ valor_credito: Num }>((f, t) =>
      supabase.from("consorcio_cotas").select("valor_credito").gte("data_adesao", de).lte("data_adesao", ate).not("status", "in", "(proposta,cancelada)").order("id").range(f, t),
    ),
    fetchAll<{ premio_liquido: Num }>((f, t) =>
      supabase.from("seguro_apolices").select("premio_liquido").gte("inicio_vigencia", de).lte("inicio_vigencia", ate).in("status", ["vigente", "renovada"]).order("id").range(f, t),
    ),
  ]);
  const credito = sum(cotas, (c) => c.valor_credito);
  const premio = sum(apolices, (a) => a.premio_liquido);
  return (
    <Card>
      <CardHeader
        icon={<TrendingUp className="h-4 w-4" />}
        title="Comercial"
        description={`Consórcios & seguros · ${monthLong(mes)}`}
        action={
          <Link href="/comercial" className={linkCls}>
            Painel comercial
          </Link>
        }
      />
      <CardBody className={compact ? "grid grid-cols-2 gap-4" : "grid gap-4 sm:grid-cols-2"}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
            <Landmark className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted">Crédito vendido</p>
            <p className="truncate text-lg font-bold tabular-nums">{brlShort(credito)}</p>
            <p className="text-[11px] text-muted">{num(cotas.length)} cota(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted">Prêmios emitidos</p>
            <p className="truncate text-lg font-bold tabular-nums">{brlShort(premio)}</p>
            <p className="text-[11px] text-muted">{num(apolices.length)} apólice(s)</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------- Custas e honorários (financeiro)

const SAIDAS = ["custas", "despesa", "deposito_judicial"];
const HONORARIOS = ["honorarios_contratuais", "honorarios_sucumbenciais", "honorarios_exito"];

export async function CustasResumoCard() {
  const supabase = await createClient();
  const mes = currentMonth();
  const today = todayISO();
  const rows = await fetchAll<{ tipo: string; valor: Num; status: string; data: string; vencimento: string | null }>((f, t) =>
    supabase.from("processo_lancamentos").select("tipo, valor, status, data, vencimento").or(`status.eq.previsto,data.gte.${firstDay(mes)}`).neq("status", "cancelado").order("id").range(f, t),
  );
  const inMes = (r: { data: string }) => r.data.slice(0, 7) === mes;
  const aPagar = rows.filter((r) => r.status === "previsto" && SAIDAS.includes(r.tipo));
  const aPagarVencido = aPagar.filter((r) => r.vencimento && r.vencimento < today);
  const pagoMes = rows.filter((r) => r.status === "pago" && SAIDAS.includes(r.tipo) && inMes(r));
  const aReceber = rows.filter((r) => r.status === "previsto" && HONORARIOS.includes(r.tipo));
  const recebidoMes = rows.filter((r) => r.status === "recebido" && HONORARIOS.includes(r.tipo) && inMes(r));
  const items = [
    { label: "Custas e despesas a pagar", value: sum(aPagar, (r) => r.valor), hint: aPagarVencido.length ? `${num(aPagarVencido.length)} vencida(s)` : `${num(aPagar.length)} lançamento(s)`, alert: aPagarVencido.length > 0 },
    { label: "Pagas no mês", value: sum(pagoMes, (r) => r.valor), hint: `${num(pagoMes.length)} lançamento(s)` },
    { label: "Honorários a receber", value: sum(aReceber, (r) => r.valor), hint: `${num(aReceber.length)} previsto(s)` },
    { label: "Honorários recebidos no mês", value: sum(recebidoMes, (r) => r.valor), hint: `${num(recebidoMes.length)} lançamento(s)` },
  ];
  return (
    <Card>
      <CardHeader
        icon={<Receipt className="h-4 w-4" />}
        title="Custas e honorários"
        description={`Lançamentos dos processos · ${monthLong(mes)}`}
        action={
          <Link href="/relatorios" className={linkCls}>
            Relatório jurídico
          </Link>
        }
      />
      <CardBody className="grid grid-cols-2 gap-4">
        {items.map((i) => (
          <div key={i.label} className="min-w-0 rounded-xl border border-line p-3">
            <p className="truncate text-xs text-muted">{i.label}</p>
            <p className="mt-1 truncate text-lg font-bold tabular-nums" title={brl(i.value)}>
              {brlShort(i.value)}
            </p>
            <p className={i.alert ? "text-[11px] font-semibold text-red-600 dark:text-red-400" : "text-[11px] text-muted"}>{i.hint}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------- Tarefas e agenda

interface TarefaRow { id: string; titulo: string; prioridade: string; vencimento: string | null; status: string; processo_id: string | null }

export async function MinhasTarefasCard({ userId }: { userId: string }) {
  const supabase = await createClient();
  const today = todayISO();
  const { data } = await supabase
    .from("tarefas")
    .select("id, titulo, prioridade, vencimento, status, processo_id")
    .eq("responsavel_id", userId)
    .neq("status", "concluida")
    .order("vencimento", { ascending: true, nullsFirst: false })
    .limit(50);
  const tarefas = (data ?? []) as TarefaRow[];
  const atrasadas = tarefas.filter((t) => t.vencimento && t.vencimento < today).length;
  return (
    <Card>
      <CardHeader
        icon={<ListChecks className="h-4 w-4" />}
        title="Minhas tarefas e demandas"
        description={atrasadas ? `${num(tarefas.length)} pendente(s) · ${num(atrasadas)} atrasada(s)` : `${num(tarefas.length)} pendente(s)`}
        action={
          <Link href="/tarefas" className={linkCls}>
            Tarefas
          </Link>
        }
      />
      {tarefas.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-6 w-6" />} title="Tudo em dia" description="Você não tem tarefas pendentes." />
      ) : (
        <ul className="divide-y divide-line">
          {tarefas.slice(0, 7).map((t) => {
            const late = !!t.vencimento && t.vencimento < today;
            return (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                {late ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-label="Atrasada" /> : <Briefcase className="h-4 w-4 shrink-0 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.titulo}</p>
                  <p className={`mt-0.5 text-xs ${late ? "font-semibold text-red-600 dark:text-red-400" : "text-muted"}`}>
                    {t.vencimento ? `${late ? "Venceu em" : "Vence em"} ${date(t.vencimento)}` : "Sem prazo"}
                    {t.processo_id && (
                      <>
                        {" · "}
                        <Link href={`/processos/${t.processo_id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                          processo
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {late ? <Badge tone="red">Atrasada</Badge> : <StatusBadge options={PRIORIDADES} value={t.prioridade} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

interface EventoRow { id: string; titulo: string; tipo: string; inicio: string; dia_inteiro: boolean; local: string | null }

export async function AgendaCard({ userId }: { userId: string }) {
  const supabase = await createClient();
  const today = todayISO();
  const { data } = await supabase
    .from("agenda_eventos")
    .select("id, titulo, tipo, inicio, dia_inteiro, local")
    .eq("status", "agendado")
    .gte("fim", new Date().toISOString())
    .lt("inicio", new Date(spStartOf(addDays(today, 8))).toISOString())
    .or(`responsavel_id.eq.${userId},participantes.cs.{${userId}}`)
    .order("inicio")
    .limit(7);
  const eventos = (data ?? []) as EventoRow[];
  const when = (e: EventoRow) => {
    const d = spDateOf(e.inicio);
    const diff = daysUntil(d);
    const day = d <= today ? "Hoje" : diff === 1 ? "Amanhã" : new Date(e.inicio).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
    return e.dia_inteiro ? `${day} · dia inteiro` : `${day} · ${time(e.inicio)}`;
  };
  return (
    <Card>
      <CardHeader
        icon={<CalendarClock className="h-4 w-4" />}
        title="Agenda"
        description="Seus próximos 7 dias"
        action={
          <Link href="/agenda" className={linkCls}>
            Abrir agenda
          </Link>
        }
      />
      {eventos.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title="Agenda livre"
          description="Nenhum compromisso nos próximos 7 dias."
          action={
            <LinkButton href="/agenda?novo=1" size="sm" variant="outline">
              Agendar
            </LinkButton>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {eventos.map((e) => (
            <li key={e.id} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-0.5 w-1 self-stretch rounded-full bg-brand-500/70" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{e.titulo}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {when(e)}
                  {e.local ? ` · ${e.local}` : ""}
                </p>
              </div>
              <StatusBadge options={EVENTO_TIPOS} value={e.tipo} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Link discreto para o painel comercial. */
export function ComercialLink() {
  return (
    <Link href="/comercial" className="group card flex items-center gap-4 p-5 transition hover:shadow-pop">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-lg shadow-accent-600/30">
        <TrendingUp className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Painel comercial completo</p>
        <p className="text-xs text-muted">Produção, funil, metas, comissões e renovações</p>
      </div>
      <ArrowRight className="h-5 w-5 text-muted transition group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}
