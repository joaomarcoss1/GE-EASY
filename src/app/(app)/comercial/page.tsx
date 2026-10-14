import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  Crown,
  Filter,
  Landmark,
  ListChecks,
  PieChart as PieIcon,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Briefcase,
  BarChart3,
} from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isBackofficeRole } from "@/lib/rbac";
import { getProfileMap } from "@/lib/data";
import { CATEGORIAS_CONSORCIO, ETAPAS, EVENTO_TIPOS, META_TIPOS, PRIORIDADES, RAMOS_SEGURO } from "@/lib/constants";
import { brl, brlShort, date, daysUntil, num, pct, time, todayISO } from "@/lib/format";
import type { MetaTipo } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { CarteiraDonut, HBarChart, ProducaoChart, type DonutSlice, type HBarPoint, type ProducaoPoint } from "@/components/dashboard/charts";
import { PermissionAlert } from "@/components/dashboard/permission-alert";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, addMonths, currentMonth, firstDay, lastMonths, monthLong, monthShort, spDateOf, spStartOf, sum, trendOf, TZ } from "@/components/dashboard/periods";
import { isCountMeta, realizadoMeta, type RealizadoRows } from "@/components/metas/realizado";

export const metadata: Metadata = { title: "Painel comercial" };

type Num = number | string;
interface CotaRow { valor_credito: Num; data_adesao: string; consultor_id: string | null; status: string }
interface ApoliceRow { premio_liquido: Num; inicio_vigencia: string; consultor_id: string | null }
interface ComissaoRow { valor_corretora: Num; valor_consultor: Num; competencia: string; consultor_id: string | null }
interface ClienteRow { created_at: string; consultor_id: string | null }
interface OportRow { etapa: string; valor: Num; fechado_em: string | null }
interface CarteiraCotaRow { categoria: string; valor_credito: Num }
interface CarteiraApoliceRow { ramo: string; premio_liquido: Num }
type ClienteRef = { nome: string } | { nome: string }[] | null;
interface EventoRow { id: string; titulo: string; tipo: string; inicio: string; fim: string; dia_inteiro: boolean; local: string | null; cliente_id: string | null; clientes: ClienteRef }
interface TarefaRow { id: string; titulo: string; prioridade: string; vencimento: string | null; status: string; cliente_id: string | null }
interface RenovacaoRow { id: string; ramo: string; fim_vigencia: string; premio_liquido: Num; numero_apolice: string | null; cliente_id: string; clientes: ClienteRef }
interface MetaRow { id: string; consultor_id: string | null; tipo: MetaTipo; valor_meta: Num }

const clienteNome = (c: ClienteRef) => (Array.isArray(c) ? c[0]?.nome : c?.nome) ?? null;
const OPEN_STAGES = ["novo", "contato", "qualificacao", "proposta", "negociacao"] as const;

function greeting() {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function eventWhen(e: EventoRow, today: string) {
  const d = spDateOf(e.inicio);
  const diff = daysUntil(d);
  const day =
    d <= today ? "Hoje" : diff === 1 ? "Amanhã" : new Date(e.inicio).toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
  return e.dia_inteiro ? `${day} · dia inteiro` : `${day} · ${time(e.inicio)}`;
}

export default async function ComercialPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("comercial.view");
  const sp = await searchParams;
  const backoffice = isBackofficeRole(profile.role);
  const supabase = await createClient();

  const today = todayISO();
  const mes = currentMonth();
  const prev = addMonths(mes, -1);
  const meses = lastMonths(mes, 12);
  const start12 = firstDay(meses[0]);
  const monthStartTs = new Date(spStartOf(firstDay(mes))).toISOString();
  const nowIso = new Date().toISOString();
  const in7Iso = new Date(spStartOf(addDays(today, 8))).toISOString();

  const [cotas, apolices, comissoes, clientesNovos, oportunidades, carteiraCotas, carteiraApolices, eventosRes, tarefasRes, renovacoesRes, metasRes, profiles] = await Promise.all([
    fetchAll<CotaRow>((f, t) =>
      supabase.from("consorcio_cotas").select("valor_credito, data_adesao, consultor_id, status").gte("data_adesao", start12).not("status", "in", "(proposta,cancelada)").order("id").range(f, t),
    ),
    fetchAll<ApoliceRow>((f, t) =>
      supabase.from("seguro_apolices").select("premio_liquido, inicio_vigencia, consultor_id").gte("inicio_vigencia", start12).in("status", ["vigente", "renovada"]).order("id").range(f, t),
    ),
    fetchAll<ComissaoRow>((f, t) =>
      supabase
        .from("comissoes")
        .select("valor_corretora, valor_consultor, competencia, consultor_id")
        .gte("competencia", firstDay(prev))
        .lte("competencia", firstDay(mes))
        .neq("status", "estornada")
        .order("id")
        .range(f, t),
    ),
    fetchAll<ClienteRow>((f, t) => supabase.from("clientes").select("created_at, consultor_id").gte("created_at", spStartOf(firstDay(prev))).order("id").range(f, t)),
    fetchAll<OportRow>((f, t) =>
      supabase.from("oportunidades").select("etapa, valor, fechado_em").or(`etapa.in.(${OPEN_STAGES.join(",")}),fechado_em.gte.${monthStartTs}`).order("id").range(f, t),
    ),
    fetchAll<CarteiraCotaRow>((f, t) => supabase.from("consorcio_cotas").select("categoria, valor_credito").in("status", ["ativa", "contemplada"]).order("id").range(f, t)),
    fetchAll<CarteiraApoliceRow>((f, t) => supabase.from("seguro_apolices").select("ramo, premio_liquido").eq("status", "vigente").order("id").range(f, t)),
    supabase
      .from("agenda_eventos")
      .select("id, titulo, tipo, inicio, fim, dia_inteiro, local, cliente_id, clientes(nome)")
      .eq("status", "agendado")
      .gte("fim", nowIso)
      .lt("inicio", in7Iso)
      .or(`responsavel_id.eq.${userId},participantes.cs.{${userId}}`)
      .order("inicio")
      .limit(6),
    supabase
      .from("tarefas")
      .select("id, titulo, prioridade, vencimento, status, cliente_id")
      .eq("responsavel_id", userId)
      .neq("status", "concluida")
      .order("vencimento", { ascending: true, nullsFirst: false })
      .limit(50),
    supabase
      .from("seguro_apolices")
      .select("id, ramo, fim_vigencia, premio_liquido, numero_apolice, cliente_id, clientes(nome)")
      .eq("status", "vigente")
      .gte("fim_vigencia", today)
      .lte("fim_vigencia", addDays(today, 30))
      .order("fim_vigencia")
      .limit(6),
    supabase.from("metas").select("id, consultor_id, tipo, valor_meta").eq("periodo", firstDay(mes)),
    getProfileMap(),
  ]);

  const eventos = (eventosRes.data ?? []) as EventoRow[];
  const tarefas = (tarefasRes.data ?? []) as TarefaRow[];
  const renovacoes = (renovacoesRes.data ?? []) as RenovacaoRow[];
  const metas = (metasRes.data ?? []) as MetaRow[];

  // ------------------------------------------------------------------ KPIs
  const inMonth = (d: string, m: string) => d.slice(0, 7) === m;
  const cotasMes = cotas.filter((c) => inMonth(c.data_adesao, mes));
  const cotasPrev = cotas.filter((c) => inMonth(c.data_adesao, prev));
  const apolMes = apolices.filter((a) => inMonth(a.inicio_vigencia, mes));
  const apolPrev = apolices.filter((a) => inMonth(a.inicio_vigencia, prev));
  const comMes = comissoes.filter((c) => inMonth(c.competencia, mes));
  const comPrev = comissoes.filter((c) => inMonth(c.competencia, prev));
  const comValor = (rows: ComissaoRow[]) => sum(rows, (r) => (backoffice ? r.valor_corretora : r.valor_consultor));
  const cliMes = clientesNovos.filter((c) => inMonth(spDateOf(c.created_at), mes));
  const cliPrev = clientesNovos.filter((c) => inMonth(spDateOf(c.created_at), prev));

  const creditoMes = sum(cotasMes, (c) => c.valor_credito);
  const creditoPrev = sum(cotasPrev, (c) => c.valor_credito);
  const premioMes = sum(apolMes, (a) => a.premio_liquido);
  const premioPrev = sum(apolPrev, (a) => a.premio_liquido);
  const comissaoMes = comValor(comMes);
  const comissaoPrev = comValor(comPrev);

  // ------------------------------------------------------------------ Gráficos
  const producao: ProducaoPoint[] = meses.map((m) => ({
    mes: m,
    label: monthShort(m),
    consorcio: sum(cotas.filter((c) => inMonth(c.data_adesao, m)), (c) => c.valor_credito),
    seguro: sum(apolices.filter((a) => inMonth(a.inicio_vigencia, m)), (a) => a.premio_liquido),
  }));

  const ganhasMes = oportunidades.filter((o) => o.etapa === "ganho");
  const perdidasMes = oportunidades.filter((o) => o.etapa === "perdido");
  const funil: HBarPoint[] = [...OPEN_STAGES, "ganho" as const].map((etapa) => {
    const rows = oportunidades.filter((o) => o.etapa === etapa);
    const valor = sum(rows, (o) => o.valor);
    return {
      label: etapa === "ganho" ? "Ganho no mês" : optionLabel(ETAPAS, etapa),
      value: rows.length,
      display: `${num(rows.length)} · ${brlShort(valor)}`,
      detail: `${num(rows.length)} oportunidade(s) · ${brl(valor)}`,
    };
  });
  const pipelineValor = sum(
    oportunidades.filter((o) => (OPEN_STAGES as readonly string[]).includes(o.etapa)),
    (o) => o.valor,
  );
  const fechadas = ganhasMes.length + perdidasMes.length;
  const conversao = fechadas ? (ganhasMes.length / fechadas) * 100 : null;

  const groupSlices = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => Num, labels: { value: string; label: string }[]): DonutSlice[] => {
    const m = new Map<string, number>();
    rows.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + Number(val(r))));
    return [...m.entries()].map(([k, v]) => ({ label: optionLabel(labels, k), value: v, display: brlShort(v) }));
  };
  const slicesConsorcio = groupSlices(carteiraCotas, (c) => c.categoria, (c) => c.valor_credito, CATEGORIAS_CONSORCIO);
  const slicesSeguro = groupSlices(carteiraApolices, (a) => a.ramo, (a) => a.premio_liquido, RAMOS_SEGURO);

  // ------------------------------------------------------------------ Metas
  const realRows: RealizadoRows = { cotas: cotasMes, apolices: apolMes, clientes: cliMes, comissoes: comMes };
  const metasVisiveis = metas
    .filter((m) => (backoffice ? m.consultor_id === null : m.consultor_id === userId || m.consultor_id === null))
    .sort((a, b) => Number(a.consultor_id === null) - Number(b.consultor_id === null) || META_TIPOS.findIndex((t) => t.value === a.tipo) - META_TIPOS.findIndex((t) => t.value === b.tipo));

  // ------------------------------------------------------------------ Ranking (back-office)
  const ranking = backoffice
    ? [...profiles.values()]
        .filter((p) => p.active && ["consultor", "consultor_externo", "gestor", "admin"].includes(p.role))
        .map((p) => {
          const receita = sum(comMes.filter((c) => c.consultor_id === p.id), (c) => c.valor_corretora);
          const credito = sum(cotasMes.filter((c) => c.consultor_id === p.id), (c) => c.valor_credito);
          const premio = sum(apolMes.filter((a) => a.consultor_id === p.id), (a) => a.premio_liquido);
          const vendas = cotasMes.filter((c) => c.consultor_id === p.id).length + apolMes.filter((a) => a.consultor_id === p.id).length;
          return { p, receita, credito, premio, vendas };
        })
        .filter((r) => r.receita > 0 || r.credito > 0 || r.premio > 0)
        .sort((a, b) => b.receita - a.receita || b.credito + b.premio - (a.credito + a.premio))
        .slice(0, 5)
    : [];
  const rankingMax = Math.max(1, ...ranking.map((r) => r.receita));

  // ------------------------------------------------------------------ Tarefas
  const tarefasOrdenadas = [...tarefas].sort((a, b) => {
    const la = a.vencimento && a.vencimento < today ? 0 : 1;
    const lb = b.vencimento && b.vencimento < today ? 0 : 1;
    return la - lb || (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999");
  });
  const atrasadas = tarefas.filter((t) => t.vencimento && t.vencimento < today).length;

  const firstName = (profile.full_name || profile.email).split(/\s+/)[0];
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const canNegocio = can(profile.role, "negocios.write");
  const canCliente = can(profile.role, "clientes.write");

  return (
    <>
      {sp.erro === "permissao" && <PermissionAlert />}
      <PageHeader
        eyebrow={backoffice ? "Comercial · Consórcios & Seguros" : "Comercial · sua carteira"}
        title="Painel comercial"
        description={hoje.charAt(0).toUpperCase() + hoje.slice(1)}
        actions={
          <>
            {canCliente && (
              <LinkButton href="/clientes?novo=1" variant="secondary" size="sm">
                <UserPlus className="h-4 w-4" /> Novo cliente
              </LinkButton>
            )}
            {canNegocio && (
              <LinkButton href="/oportunidades?novo=1" variant="secondary" size="sm">
                <Filter className="h-4 w-4" /> Nova oportunidade
              </LinkButton>
            )}
            <LinkButton href="/agenda?novo=1" variant="secondary" size="sm">
              <CalendarPlus className="h-4 w-4" /> Agendar
            </LinkButton>
            {canNegocio && (
              <LinkButton href="/consorcios?novo=1" variant="secondary" size="sm">
                <Landmark className="h-4 w-4" /> Nova cota
              </LinkButton>
            )}
            {canNegocio && (
              <LinkButton href="/seguros?novo=1" variant="accent" size="sm">
                <ShieldCheck className="h-4 w-4" /> Novo seguro
              </LinkButton>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Crédito vendido no mês" value={brl(creditoMes)} icon={<Landmark className="h-5 w-5" />} trend={trendOf(creditoMes, creditoPrev)} hint={`${num(cotasMes.length)} cota(s) · vs ${monthShort(prev)}`} />
        <StatCard label="Prêmios emitidos no mês" value={brl(premioMes)} icon={<ShieldCheck className="h-5 w-5" />} tone="accent" trend={trendOf(premioMes, premioPrev)} hint={`${num(apolMes.length)} apólice(s) · vs ${monthShort(prev)}`} />
        <StatCard
          label={backoffice ? "Comissões do mês (corretora)" : "Minhas comissões do mês"}
          value={brl(comissaoMes)}
          icon={<Wallet className="h-5 w-5" />}
          tone="green"
          trend={trendOf(comissaoMes, comissaoPrev)}
          hint={`competência ${monthShort(mes)}`}
        />
        <StatCard label="Novos clientes no mês" value={num(cliMes.length)} icon={<Users className="h-5 w-5" />} tone="amber" trend={trendOf(cliMes.length, cliPrev.length)} hint={`${num(cliPrev.length)} em ${monthShort(prev)}`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Produção dos últimos 12 meses" description="Crédito de consórcio e prêmio líquido de seguros por mês de adesão / início de vigência" />
          <CardBody>
            <ProducaoChart data={producao} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<Target className="h-4 w-4" />}
            title="Metas do mês"
            description={monthLong(mes)}
            action={
              <Link href="/metas" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Ver metas
              </Link>
            }
          />
          <CardBody className="space-y-5">
            {metasVisiveis.length === 0 ? (
              <EmptyState icon={<Target className="h-6 w-6" />} title="Nenhuma meta definida" description="As metas do mês aparecem aqui assim que forem cadastradas pela gestão." />
            ) : (
              metasVisiveis.slice(0, 6).map((m) => {
                const realizado = realizadoMeta(m.tipo, m.consultor_id, realRows);
                const alvo = Number(m.valor_meta);
                const perc = alvo ? (realizado / alvo) * 100 : 0;
                const fmt = (v: number) => (isCountMeta(m.tipo) ? num(v) : brlShort(v));
                const equipeParcial = m.consultor_id === null && !backoffice;
                return (
                  <div key={m.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">
                        {optionLabel(META_TIPOS, m.tipo)}
                        {m.consultor_id === null ? <span className="ml-1.5 text-xs font-normal text-muted">{equipeParcial ? "· equipe (sua contribuição)" : "· equipe"}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums">{pct(perc, 0)}</span>
                    </div>
                    <Progress value={perc} tone={perc >= 100 ? "green" : perc < 50 ? "accent" : "brand"} />
                    <p className="mt-1 text-xs text-muted">
                      {fmt(realizado)} de {fmt(alvo)}
                      {realizado < alvo ? ` · faltam ${fmt(alvo - realizado)}` : " · meta batida"}
                    </p>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>

      <div className={`mt-6 grid gap-6 ${backoffice ? "xl:grid-cols-3" : "lg:grid-cols-2"}`}>
        <Card>
          <CardHeader
            icon={<Filter className="h-4 w-4" />}
            title="Funil de vendas"
            description={`Em aberto: ${brl(pipelineValor)}`}
            action={
              <Link href="/oportunidades" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Abrir funil
              </Link>
            }
          />
          <CardBody>
            <HBarChart data={funil} labelWidth={104} emptyText="Nenhuma oportunidade em aberto." />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-xs text-muted">
              <span>
                Perdidas no mês: <strong className="text-fg">{num(perdidasMes.length)}</strong>
              </span>
              <span>
                Conversão no mês: <strong className="text-fg">{conversao === null ? "—" : pct(conversao, 0)}</strong>
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={<PieIcon className="h-4 w-4" />} title="Carteira ativa" description="Consórcio por categoria · seguros por ramo" />
          <CardBody>
            <CarteiraDonut
              consorcio={slicesConsorcio}
              seguro={slicesSeguro}
              totals={{
                consorcio: brlShort(sum(carteiraCotas, (c) => c.valor_credito)),
                seguro: brlShort(sum(carteiraApolices, (a) => a.premio_liquido)),
                cotas: carteiraCotas.length,
                apolices: carteiraApolices.length,
              }}
            />
          </CardBody>
        </Card>

        {backoffice && (
          <Card>
            <CardHeader
              icon={<Crown className="h-4 w-4" />}
              title="Ranking de consultores"
              description={`Comissão gerada em ${monthLong(mes)}`}
              action={
                <Link href="/metas" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  Ranking completo
                </Link>
              }
            />
            <CardBody className="space-y-4">
              {ranking.length === 0 ? (
                <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="Sem produção no mês" description="Assim que houver vendas, o ranking aparece aqui." />
              ) : (
                ranking.map((r, i) => (
                  <div key={r.p.id} className="flex items-center gap-3">
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        i === 0 ? "bg-amber-400 text-amber-950" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-950" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <Avatar name={r.p.full_name} src={r.p.avatar_url} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{r.p.full_name || r.p.email}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{brlShort(r.receita)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-brand-500 dark:bg-brand-400" style={{ width: `${(r.receita / rankingMax) * 100}%` }} />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted">
                        {num(r.vendas)} venda(s) · crédito {brlShort(r.credito)} · prêmio {brlShort(r.premio)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader
            icon={<CalendarClock className="h-4 w-4" />}
            title="Próximos compromissos"
            description="Seus próximos 7 dias"
            action={
              <Link href="/agenda" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Agenda
              </Link>
            }
          />
          {eventos.length === 0 ? (
            <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Agenda livre" description="Nenhum compromisso nos próximos 7 dias." action={<LinkButton href="/agenda?novo=1" size="sm" variant="outline">Agendar</LinkButton>} />
          ) : (
            <ul className="divide-y divide-line">
              {eventos.map((e) => {
                const cli = clienteNome(e.clientes);
                return (
                  <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                    <div className="mt-0.5 w-1 self-stretch rounded-full bg-brand-500/70" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{e.titulo}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {eventWhen(e, today)}
                        {e.local ? ` · ${e.local}` : ""}
                      </p>
                      {cli && e.cliente_id && (
                        <Link href={`/clientes/${e.cliente_id}`} className="mt-0.5 block truncate text-xs text-brand-600 hover:underline dark:text-brand-300">
                          {cli}
                        </Link>
                      )}
                    </div>
                    <StatusBadge options={EVENTO_TIPOS} value={e.tipo} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<ListChecks className="h-4 w-4" />}
            title="Minhas tarefas"
            description={atrasadas ? `${num(tarefas.length)} pendente(s) · ${num(atrasadas)} atrasada(s)` : `${num(tarefas.length)} pendente(s)`}
            action={
              <Link href="/tarefas" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Tarefas
              </Link>
            }
          />
          {tarefasOrdenadas.length === 0 ? (
            <EmptyState icon={<ListChecks className="h-6 w-6" />} title="Tudo em dia" description="Você não tem tarefas pendentes." />
          ) : (
            <ul className="divide-y divide-line">
              {tarefasOrdenadas.slice(0, 6).map((t) => {
                const late = !!t.vencimento && t.vencimento < today;
                return (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    {late ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" aria-label="Atrasada" /> : <Briefcase className="h-4 w-4 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t.titulo}</p>
                      <p className={`mt-0.5 text-xs ${late ? "font-semibold text-red-600 dark:text-red-400" : "text-muted"}`}>
                        {t.vencimento ? `${late ? "Venceu em" : "Vence em"} ${date(t.vencimento)}` : "Sem prazo"}
                      </p>
                    </div>
                    {late ? <Badge tone="red">Atrasada</Badge> : <StatusBadge options={PRIORIDADES} value={t.prioridade} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader
            icon={<RefreshCw className="h-4 w-4" />}
            title="Renovações em 30 dias"
            description="Apólices vigentes perto do vencimento"
            action={
              <Link href="/seguros" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Seguros
              </Link>
            }
          />
          {renovacoes.length === 0 ? (
            <EmptyState icon={<RefreshCw className="h-6 w-6" />} title="Nenhuma renovação próxima" description="Não há apólices vencendo nos próximos 30 dias." />
          ) : (
            <ul className="divide-y divide-line">
              {renovacoes.map((r) => {
                const dias = daysUntil(r.fim_vigencia);
                return (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-center leading-none ${dias <= 7 ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                      <span>
                        <span className="block text-sm font-bold">{dias}</span>
                        <span className="text-[9px] font-semibold uppercase">dias</span>
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/clientes/${r.cliente_id}`} className="block truncate text-sm font-semibold hover:text-brand-600">
                        {clienteNome(r.clientes) ?? "Cliente"}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {optionLabel(RAMOS_SEGURO, r.ramo)}
                        {r.numero_apolice ? ` · ${r.numero_apolice}` : ""} · vence {date(r.fim_vigencia)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{brlShort(r.premio_liquido)}</span>
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
