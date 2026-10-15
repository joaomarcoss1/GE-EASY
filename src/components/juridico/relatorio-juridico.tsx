import "server-only";
import { AlarmClock, Building2, CheckCircle2, Gavel, PieChart, Receipt, Scale, ShieldAlert, Vault } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { departamentoMap, getProfileMap } from "@/lib/data";
import { AUDIENCIA_TIPOS, LANCAMENTO_STATUS, LANCAMENTO_TIPOS, PROCESSO_AREAS, PROCESSO_RISCO } from "@/lib/constants";
import { brl, brlShort, num, pct, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HBarChart } from "@/components/dashboard/charts";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, spDateOf, spStartOf, sum } from "@/components/dashboard/periods";

type Num = number | string;

interface ProcRow {
  area: string;
  status: string;
  risco: string | null;
  valor_causa: Num | null;
  valor_provisionado: Num | null;
  departamento_id: string | null;
  data_distribuicao: string | null;
  data_encerramento: string | null;
  created_at: string;
}
interface PrazoRow {
  status: string;
  data_fim: string;
  responsavel_id: string | null;
  cumprido_em: string | null;
}
interface AudRow {
  tipo: string;
  status: string;
}
interface LancRow {
  tipo: string;
  status: string;
  valor: Num;
}

const ATIVOS = ["ativo", "suspenso"];

function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-10 flex items-center gap-2 text-lg font-bold tracking-tight print:mt-6 print:break-after-avoid">
      <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-700 text-xs font-bold text-white">{n}</span>
      {children}
    </h2>
  );
}

function ShareBar({ value, max, cls = "bg-brand-500 dark:bg-brand-400" }: { value: number; max: number; cls?: string }) {
  const w = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full min-w-[80px] overflow-hidden rounded-full bg-surface-2">
      <div className={cn("h-full rounded-full", cls)} style={{ width: `${w}%` }} />
    </div>
  );
}

const Count = ({ v, tone }: { v: number; tone?: "red" | "green" | "amber" }) =>
  v ? (
    <span
      className={cn(
        "tabular-nums",
        tone === "red" && "font-semibold text-red-600 dark:text-red-400",
        tone === "green" && "font-semibold text-emerald-700 dark:text-emerald-400",
        tone === "amber" && "font-semibold text-amber-700 dark:text-amber-400",
      )}
    >
      {num(v)}
    </span>
  ) : (
    <span className="text-muted">0</span>
  );

interface FlowRow {
  key: string;
  label: string;
  novos: number;
  encerrados: number;
  ativos: number;
}

function AreaDepTable({ rows, firstCol, tot }: { rows: FlowRow[]; firstCol: string; tot: { novos: number; encerrados: number; ativos: number } }) {
  if (rows.length === 0) return <EmptyState title="Sem processos" />;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>{firstCol}</th>
            <th className="text-right">Novos</th>
            <th className="text-right">Encerrados</th>
            <th className="text-right">Saldo</th>
            <th className="text-right">Ativos hoje</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const saldo = r.novos - r.encerrados;
            return (
              <tr key={r.key}>
                <td className="font-medium">{r.label}</td>
                <td className="text-right tabular-nums">{num(r.novos)}</td>
                <td className="text-right tabular-nums">{num(r.encerrados)}</td>
                <td
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    saldo > 0 ? "text-brand-700 dark:text-brand-300" : saldo < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted",
                  )}
                >
                  {saldo > 0 ? `+${saldo}` : saldo}
                </td>
                <td className="text-right tabular-nums">{num(r.ativos)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-surface-2 font-semibold">
            <td className="px-4 py-3">Total</td>
            <td className="px-4 py-3 text-right tabular-nums">{num(tot.novos)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{num(tot.encerrados)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{tot.novos - tot.encerrados > 0 ? `+${tot.novos - tot.encerrados}` : tot.novos - tot.encerrados}</td>
            <td className="px-4 py-3 text-right tabular-nums">{num(tot.ativos)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export async function RelatorioJuridico({ de, ate }: { de: string; ate: string }) {
  const supabase = await createClient();
  const today = todayISO();
  const deTs = spStartOf(de);
  const ateTs = spStartOf(addDays(ate, 1));

  const [processos, prazos, audiencias, lancamentos, profiles, deps] = await Promise.all([
    fetchAll<ProcRow>(
      (f, t) =>
        supabase
          .from("processos")
          .select("area, status, risco, valor_causa, valor_provisionado, departamento_id, data_distribuicao, data_encerramento, created_at")
          .order("id")
          .range(f, t),
      20_000,
    ),
    fetchAll<PrazoRow>((f, t) =>
      supabase.from("prazos").select("status, data_fim, responsavel_id, cumprido_em").gte("data_fim", de).lte("data_fim", ate).neq("status", "cancelado").order("id").range(f, t),
    ),
    fetchAll<AudRow>((f, t) => supabase.from("audiencias").select("tipo, status").gte("data_hora", deTs).lt("data_hora", ateTs).order("id").range(f, t)),
    fetchAll<LancRow>((f, t) => supabase.from("processo_lancamentos").select("tipo, status, valor").gte("data", de).lte("data", ate).order("id").range(f, t)),
    getProfileMap(),
    departamentoMap(),
  ]);

  // ---------------------------------------------------------------- 1. Entradas e encerramentos
  const inicio = (p: ProcRow) => p.data_distribuicao ?? spDateOf(p.created_at);
  const novos = processos.filter((p) => {
    const d = inicio(p);
    return d >= de && d <= ate;
  });
  const encerrados = processos.filter((p) => p.data_encerramento && p.data_encerramento >= de && p.data_encerramento <= ate);
  const ativos = processos.filter((p) => ATIVOS.includes(p.status));
  const tot = { novos: novos.length, encerrados: encerrados.length, ativos: ativos.length };

  const porArea = PROCESSO_AREAS.map((a) => ({
    key: a.value,
    label: a.label,
    novos: novos.filter((p) => p.area === a.value).length,
    encerrados: encerrados.filter((p) => p.area === a.value).length,
    ativos: ativos.filter((p) => p.area === a.value).length,
  }))
    .filter((r) => r.novos || r.encerrados || r.ativos)
    .sort((a, b) => b.novos - a.novos || b.ativos - a.ativos);

  const depIds = [...new Set(processos.map((p) => p.departamento_id))];
  const porDep = depIds
    .map((id) => ({
      key: id ?? "none",
      label: id ? (deps.get(id)?.nome ?? "Departamento") : "Sem departamento",
      novos: novos.filter((p) => p.departamento_id === id).length,
      encerrados: encerrados.filter((p) => p.departamento_id === id).length,
      ativos: ativos.filter((p) => p.departamento_id === id).length,
    }))
    .filter((r) => r.novos || r.encerrados || r.ativos)
    .sort((a, b) => b.ativos - a.ativos || b.novos - a.novos);

  // ---------------------------------------------------------------- 2. Prazos por responsável
  const vencidoSemBaixa = (p: PrazoRow) => p.status === "pendente" && p.data_fim < today;
  const cumpridoAtraso = (p: PrazoRow) => p.status === "cumprido" && !!p.cumprido_em && spDateOf(p.cumprido_em) > p.data_fim;
  const respIds = [...new Set(prazos.map((p) => p.responsavel_id))];
  const porResp = respIds
    .map((id) => {
      const rows = prazos.filter((p) => p.responsavel_id === id);
      const cumpridos = rows.filter((p) => p.status === "cumprido").length;
      const perdidos = rows.filter((p) => p.status === "perdido").length;
      const vencidos = rows.filter(vencidoSemBaixa).length;
      const aVencer = rows.filter((p) => p.status === "pendente" && p.data_fim >= today).length;
      const base = cumpridos + perdidos + vencidos;
      return {
        id,
        nome: id ? (profiles.get(id)?.full_name ?? "—") : "Sem responsável",
        total: rows.length,
        cumpridos,
        atraso: rows.filter(cumpridoAtraso).length,
        perdidos,
        vencidos,
        aVencer,
        taxa: base ? (cumpridos / base) * 100 : null,
      };
    })
    .sort((a, b) => b.vencidos + b.perdidos - (a.vencidos + a.perdidos) || b.total - a.total);
  const totCumpridos = porResp.reduce((a, r) => a + r.cumpridos, 0);
  const totPerdidos = porResp.reduce((a, r) => a + r.perdidos, 0);
  const totVencidos = porResp.reduce((a, r) => a + r.vencidos, 0);
  const totAVencer = porResp.reduce((a, r) => a + r.aVencer, 0);
  const totAtraso = porResp.reduce((a, r) => a + r.atraso, 0);
  const baseTaxa = totCumpridos + totPerdidos + totVencidos;
  const taxaGeral = baseTaxa ? (totCumpridos / baseTaxa) * 100 : null;

  // ---------------------------------------------------------------- 3. Audiências
  const audPorTipo = AUDIENCIA_TIPOS.map((t) => {
    const rows = audiencias.filter((a) => a.tipo === t.value);
    return {
      label: t.label,
      realizadas: rows.filter((a) => a.status === "realizada").length,
      agendadas: rows.filter((a) => a.status === "agendada").length,
      redesignadas: rows.filter((a) => a.status === "redesignada").length,
      canceladas: rows.filter((a) => a.status === "cancelada").length,
      total: rows.length,
    };
  }).filter((r) => r.total > 0);
  const realizadas = audiencias.filter((a) => a.status === "realizada").length;

  // ---------------------------------------------------------------- 4. Carteira por risco (posição atual)
  const riscos = [
    ...PROCESSO_RISCO.map((r) => ({ value: r.value as string | null, label: r.label, tone: r.tone })),
    { value: null, label: "Não avaliado", tone: "slate" as const },
  ];
  const porRisco = riscos.map((r) => {
    const rows = ativos.filter((p) => (p.risco ?? null) === r.value);
    return { ...r, qtd: rows.length, causa: sum(rows, (p) => p.valor_causa), provisionado: sum(rows, (p) => p.valor_provisionado) };
  });
  const provisionadoTotal = sum(ativos, (p) => p.valor_provisionado);
  const causaTotal = sum(ativos, (p) => p.valor_causa);
  const maxRiscoQtd = Math.max(1, ...porRisco.map((r) => r.qtd));

  // ---------------------------------------------------------------- 5. Custas e honorários
  const STATUS_COLS = LANCAMENTO_STATUS.filter((s) => s.value !== "cancelado");
  const porTipo = LANCAMENTO_TIPOS.map((t) => {
    const rows = lancamentos.filter((l) => l.tipo === t.value && l.status !== "cancelado");
    const byStatus = Object.fromEntries(
      STATUS_COLS.map((s) => [
        s.value,
        sum(
          rows.filter((l) => l.status === s.value),
          (l) => l.valor,
        ),
      ]),
    );
    return { label: t.label, qtd: rows.length, byStatus, total: sum(rows, (l) => l.valor) };
  }).filter((r) => r.qtd > 0);
  const lancAtivos = lancamentos.filter((l) => l.status !== "cancelado");
  const totStatus = Object.fromEntries(
    STATUS_COLS.map((s) => [
      s.value,
      sum(
        lancAtivos.filter((l) => l.status === s.value),
        (l) => l.valor,
      ),
    ]),
  );
  const HON = ["honorarios_contratuais", "honorarios_sucumbenciais", "honorarios_exito"];
  const SAI = ["custas", "despesa", "deposito_judicial"];
  const honRecebidos = sum(
    lancAtivos.filter((l) => HON.includes(l.tipo) && l.status === "recebido"),
    (l) => l.valor,
  );
  const custasPagas = sum(
    lancAtivos.filter((l) => SAI.includes(l.tipo) && l.status === "pago"),
    (l) => l.valor,
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 print:grid-cols-4">
        <StatCard label="Processos novos" value={num(novos.length)} icon={<Scale className="h-5 w-5" />} hint={`${num(encerrados.length)} encerrado(s) no período`} />
        <StatCard
          label="Cumprimento de prazos"
          value={taxaGeral === null ? "—" : pct(taxaGeral)}
          icon={<AlarmClock className="h-5 w-5" />}
          tone={totPerdidos + totVencidos ? "accent" : "green"}
          hint={`${num(totPerdidos)} perdido(s) · ${num(totVencidos)} vencido(s) sem baixa`}
        />
        <StatCard label="Audiências realizadas" value={num(realizadas)} icon={<Gavel className="h-5 w-5" />} tone="amber" hint={`${num(audiencias.length)} no período`} />
        <StatCard
          label="Provisionado (carteira ativa)"
          value={brlShort(provisionadoTotal)}
          icon={<Vault className="h-5 w-5" />}
          tone="green"
          hint={`valor da causa ${brlShort(causaTotal)}`}
        />
      </div>

      {/* 1 ---------------------------------------------------------------- */}
      <SectionTitle n={1}>Processos novos e encerrados</SectionTitle>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="print:break-inside-avoid">
          <CardHeader icon={<PieChart className="h-4 w-4" />} title="Por área" description="Novos pela data de distribuição (ou cadastro) · encerrados pela data de encerramento" />
          <AreaDepTable rows={porArea} firstCol="Área" tot={tot} />
        </Card>
        <Card className="print:break-inside-avoid">
          <CardHeader icon={<Building2 className="h-4 w-4" />} title="Por departamento" />
          <AreaDepTable rows={porDep} firstCol="Departamento" tot={tot} />
        </Card>
      </div>
      <Card className="mt-6 print:break-inside-avoid">
        <CardHeader title="Entradas por área no período" description="Processos novos" />
        <CardBody>
          <HBarChart
            data={porArea.filter((r) => r.novos > 0).map((r) => ({ label: r.label, value: r.novos, display: num(r.novos), detail: "Processos novos" }))}
            labelWidth={170}
            emptyText="Nenhum processo novo no período."
          />
        </CardBody>
      </Card>

      {/* 2 ---------------------------------------------------------------- */}
      <SectionTitle n={2}>Prazos: cumpridos × perdidos × vencidos sem baixa</SectionTitle>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Cumpridos"
          value={num(totCumpridos)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          hint={totAtraso ? `${num(totAtraso)} baixado(s) após o vencimento` : "todos no prazo"}
        />
        <StatCard label="Perdidos" value={num(totPerdidos)} icon={<ShieldAlert className="h-5 w-5" />} tone="accent" hint="marcados como perdidos" />
        <StatCard label="Vencidos sem baixa" value={num(totVencidos)} icon={<AlarmClock className="h-5 w-5" />} tone="accent" hint="pendentes com data já passada" />
        <StatCard label="A vencer" value={num(totAVencer)} icon={<AlarmClock className="h-5 w-5" />} tone="amber" hint="pendentes dentro do período" />
      </div>
      <Card className="print:break-inside-avoid">
        <CardHeader title="Por responsável" description="Prazos com vencimento no período (exceto cancelados)" />
        {porResp.length === 0 ? (
          <EmptyState title="Nenhum prazo no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Responsável</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Cumpridos</th>
                  <th className="text-right">Com atraso</th>
                  <th className="text-right">Perdidos</th>
                  <th className="text-right">Vencidos s/ baixa</th>
                  <th className="text-right">A vencer</th>
                  <th className="w-44">Cumprimento</th>
                </tr>
              </thead>
              <tbody>
                {porResp.map((r) => (
                  <tr key={r.id ?? "none"}>
                    <td className="font-medium">{r.nome}</td>
                    <td className="text-right tabular-nums">{num(r.total)}</td>
                    <td className="text-right">
                      <Count v={r.cumpridos} tone="green" />
                    </td>
                    <td className="text-right">
                      <Count v={r.atraso} tone="amber" />
                    </td>
                    <td className="text-right">
                      <Count v={r.perdidos} tone="red" />
                    </td>
                    <td className="text-right">
                      <Count v={r.vencidos} tone="red" />
                    </td>
                    <td className="text-right tabular-nums">{num(r.aVencer)}</td>
                    <td>
                      {r.taxa === null ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <ShareBar value={r.taxa} max={100} cls={r.taxa >= 95 ? "bg-emerald-500" : r.taxa >= 80 ? "bg-amber-500" : "bg-red-500"} />
                          <span className="w-12 text-right text-xs font-semibold tabular-nums">{pct(r.taxa, 0)}</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 3 ---------------------------------------------------------------- */}
      <SectionTitle n={3}>Audiências por tipo</SectionTitle>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3 print:break-inside-avoid">
          {audPorTipo.length === 0 ? (
            <EmptyState icon={<Gavel className="h-6 w-6" />} title="Nenhuma audiência no período" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="text-right">Realizadas</th>
                    <th className="text-right">Agendadas</th>
                    <th className="text-right">Redesignadas</th>
                    <th className="text-right">Canceladas</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {audPorTipo.map((r) => (
                    <tr key={r.label}>
                      <td className="font-medium">{r.label}</td>
                      <td className="text-right">
                        <Count v={r.realizadas} tone="green" />
                      </td>
                      <td className="text-right tabular-nums">{num(r.agendadas)}</td>
                      <td className="text-right">
                        <Count v={r.redesignadas} tone="amber" />
                      </td>
                      <td className="text-right tabular-nums">{num(r.canceladas)}</td>
                      <td className="text-right font-semibold tabular-nums">{num(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card className="lg:col-span-2 print:break-inside-avoid">
          <CardHeader title="Realizadas por tipo" />
          <CardBody>
            <HBarChart
              data={audPorTipo
                .filter((r) => r.realizadas > 0)
                .map((r) => ({ label: r.label.split(" (")[0], value: r.realizadas, display: num(r.realizadas), detail: "Realizadas" }))}
              colorIndex={1}
              labelWidth={110}
              emptyText="Nenhuma audiência realizada no período."
            />
          </CardBody>
        </Card>
      </div>

      {/* 4 ---------------------------------------------------------------- */}
      <SectionTitle n={4}>Carteira por risco</SectionTitle>
      <Card className="print:break-inside-avoid">
        <CardHeader title="Processos ativos e suspensos" description="Posição atual (independe do período) · classificação de risco CPC 25" />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Risco</th>
                <th className="text-right">Processos</th>
                <th className="w-48">Participação</th>
                <th className="text-right">Valor da causa</th>
                <th className="text-right">Provisionado</th>
              </tr>
            </thead>
            <tbody>
              {porRisco.map((r) => (
                <tr key={r.label}>
                  <td>
                    <Badge tone={r.tone ?? "slate"} dot>
                      {r.label}
                    </Badge>
                  </td>
                  <td className="text-right tabular-nums">{num(r.qtd)}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <ShareBar value={r.qtd} max={maxRiscoQtd} />
                      <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(ativos.length ? (r.qtd / ativos.length) * 100 : 0, 0)}</span>
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{brl(r.causa)}</td>
                  <td className="text-right font-semibold tabular-nums">{brl(r.provisionado)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{num(ativos.length)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right tabular-nums">{brl(causaTotal)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl(provisionadoTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* 5 ---------------------------------------------------------------- */}
      <SectionTitle n={5}>Custas e honorários</SectionTitle>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Custas e despesas pagas" value={brl(custasPagas)} icon={<Receipt className="h-5 w-5" />} tone="accent" hint="custas, despesas e depósitos" />
        <StatCard label="Honorários recebidos" value={brl(honRecebidos)} icon={<Receipt className="h-5 w-5" />} tone="green" hint="contratuais, sucumbenciais e êxito" />
        <StatCard label="Previsto no período" value={brl(totStatus.previsto ?? 0)} icon={<Receipt className="h-5 w-5" />} tone="amber" hint="lançamentos ainda não liquidados" />
      </div>
      <Card className="print:break-inside-avoid">
        <CardHeader title="Lançamentos por tipo e situação" description="Data do lançamento no período · cancelados excluídos" />
        {porTipo.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Nenhum lançamento no período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="text-right">Qtd.</th>
                  {STATUS_COLS.map((s) => (
                    <th key={s.value} className="text-right">
                      {s.label}
                    </th>
                  ))}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {porTipo.map((r) => (
                  <tr key={r.label}>
                    <td className="font-medium">{r.label}</td>
                    <td className="text-right tabular-nums">{num(r.qtd)}</td>
                    {STATUS_COLS.map((s) => (
                      <td key={s.value} className={cn("text-right tabular-nums", !r.byStatus[s.value] && "text-muted")}>
                        {brl(r.byStatus[s.value])}
                      </td>
                    ))}
                    <td className="text-right font-semibold tabular-nums">{brl(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{num(lancAtivos.length)}</td>
                  {STATUS_COLS.map((s) => (
                    <td key={s.value} className="px-4 py-3 text-right tabular-nums">
                      {brl(totStatus[s.value])}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right tabular-nums">{brl(sum(lancAtivos, (l) => l.valor))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-6 text-xs text-muted">
        Notas: processos novos consideram a data de distribuição (ou a data de cadastro, quando não informada); encerrados, a data de encerramento (arquivados ou encerrados).
        Prazos pelo vencimento no período; &quot;com atraso&quot; = baixados como cumpridos após a data final. Audiências pela data/hora. Lançamentos cancelados não entram nos
        totais.
      </p>
    </>
  );
}
