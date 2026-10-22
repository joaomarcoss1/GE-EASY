import type { Metadata } from "next";
import { CopyPlus, Crown, Medal, Target, Trophy, Users } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isBackofficeRole } from "@/lib/rbac";
import { consultorOptions, getProfileMap } from "@/lib/data";
import { META_TIPOS, ROLE_LABEL } from "@/lib/constants";
import { brl, brlShort, num, pct, todayISO } from "@/lib/format";
import type { MetaTipo } from "@/lib/types";
import { copiarMetasMesAnterior, createMeta, deleteMeta, updateMeta } from "@/lib/actions/metas";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar } from "@/components/ui/avatar";
import { Badge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { MonthPicker } from "@/components/comissoes/month-picker";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addMonths, currentMonth, firstDay, lastDay, monthLong, monthParam, monthShort, spDateOf, spStartOf, sum } from "@/components/dashboard/periods";
import { COTA_STATUS_META, isCountMeta, realizadoMeta, type RealizadoRows } from "@/components/metas/realizado";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Metas & ranking" };

type Num = number | string;
interface MetaRow { id: string; consultor_id: string | null; tipo: MetaTipo; valor_meta: Num }

const metaFields = (consultores: { value: string; label: string }[]): FieldDef[] => [
  { name: "tipo", label: "Tipo de meta", type: "select", options: META_TIPOS, required: true, span: 6 },
  { name: "consultor_id", label: "Consultor", type: "select", options: consultores, emptyOption: "Equipe (meta geral da corretora)", span: 6 },
  { name: "valor_meta", label: "Valor da meta", required: true, span: 6, placeholder: "Ex.: 500.000,00 ou 12", help: "Em R$ para crédito, prêmio e comissão; quantidade para novos clientes" },
];

function MetaCard({
  meta,
  realizado,
  ritmo,
  subtitle,
  manage,
}: {
  meta: MetaRow;
  realizado: number;
  ritmo: number | null;
  subtitle?: string;
  manage?: React.ReactNode;
}) {
  const alvo = Number(meta.valor_meta);
  const perc = alvo ? (realizado / alvo) * 100 : 0;
  const fmt = (v: number) => (isCountMeta(meta.tipo) ? num(v) : brl(v));
  const falta = Math.max(0, alvo - realizado);
  const noRitmo = ritmo === null || perc >= ritmo;
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-muted">{optionLabel(META_TIPOS, meta.tipo)}</p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        {manage && <div className="-mr-2 -mt-1 flex shrink-0">{manage}</div>}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight">{pct(perc, 0)}</span>
        <span className="text-xs text-muted">atingido</span>
      </div>
      <Progress value={perc} tone={perc >= 100 ? "green" : noRitmo ? "brand" : "accent"} className="mt-3" />
      <div className="mt-3 space-y-0.5 text-xs">
        <p>
          <span className="font-semibold">{fmt(realizado)}</span> <span className="text-muted">de {fmt(alvo)}</span>
        </p>
        {perc >= 100 ? (
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">Meta batida{realizado > alvo ? ` · +${fmt(realizado - alvo)}` : ""}</p>
        ) : (
          <p className="text-muted">
            Faltam <span className="font-semibold text-fg">{fmt(falta)}</span>
            {ritmo !== null && <span className={noRitmo ? "" : " text-accent-600 dark:text-accent-400"}>{noRitmo ? " · no ritmo" : ` · abaixo do ritmo (${pct(ritmo, 0)})`}</span>}
          </p>
        )}
      </div>
    </Card>
  );
}

export default async function MetasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireSession();
  const sp = await searchParams;
  const mes = monthParam(sp.mes);
  const backoffice = isBackofficeRole(profile.role);
  const manage = can(profile, "metas.manage");
  const supabase = await createClient();
  const de = firstDay(mes);
  const ate = lastDay(mes);

  const [cotas, apolices, clientes, comissoes, metasRes, profiles, consultores] = await Promise.all([
    fetchAll<RealizadoRows["cotas"][number]>((f, t) =>
      supabase.from("consorcio_cotas").select("valor_credito, consultor_id, status").gte("data_adesao", de).lte("data_adesao", ate).in("status", COTA_STATUS_META).order("id").range(f, t),
    ),
    fetchAll<RealizadoRows["apolices"][number]>((f, t) =>
      supabase.from("seguro_apolices").select("premio_liquido, consultor_id").gte("inicio_vigencia", de).lte("inicio_vigencia", ate).in("status", ["vigente", "renovada"]).order("id").range(f, t),
    ),
    fetchAll<{ consultor_id: string | null; created_at: string }>((f, t) =>
      supabase.from("clientes").select("consultor_id, created_at").gte("created_at", spStartOf(de)).lt("created_at", spStartOf(firstDay(addMonths(mes, 1)))).order("id").range(f, t),
    ),
    fetchAll<RealizadoRows["comissoes"][number]>((f, t) =>
      supabase.from("comissoes").select("valor_corretora, consultor_id").eq("competencia", de).neq("status", "estornada").order("id").range(f, t),
    ),
    supabase.from("metas").select("id, consultor_id, tipo, valor_meta").eq("periodo", de),
    getProfileMap(),
    manage ? consultorOptions() : Promise.resolve([]),
  ]);
  const rows: RealizadoRows = { cotas, apolices, clientes: clientes.filter((c) => spDateOf(c.created_at).startsWith(mes)), comissoes };
  const metas = ((metasRes.data ?? []) as MetaRow[]).sort((a, b) => META_TIPOS.findIndex((t) => t.value === a.tipo) - META_TIPOS.findIndex((t) => t.value === b.tipo));

  // Ritmo esperado (só para o mês corrente)
  const today = todayISO();
  const ritmo = mes === currentMonth() ? (Number(today.slice(8, 10)) / Number(ate.slice(8, 10))) * 100 : null;

  const equipe = metas.filter((m) => m.consultor_id === null);
  const individuais = metas.filter((m) => m.consultor_id !== null && (backoffice || m.consultor_id === userId));
  const fields = metaFields(consultores);

  const manageButtons = (m: MetaRow) =>
    manage ? (
      <>
        <FormDrawerButton
          action={updateMeta}
          fields={fields}
          hidden={{ id: m.id, periodo: mes }}
          values={{ tipo: m.tipo, consultor_id: m.consultor_id, valor_meta: Number(m.valor_meta) }}
          title="Editar meta"
          description={monthLong(mes)}
          icon="edit"
          variant="ghost"
          size="icon"
          width="max-w-lg"
        />
        <ConfirmAction action={deleteMeta} id={m.id} title="Excluir meta" message="A meta será removida deste mês. O histórico de vendas não é afetado." label="Excluir meta" />
      </>
    ) : null;

  // ------------------------------------------------------------------ Ranking
  const ranking = backoffice
    ? [...profiles.values()]
        .filter((p) => p.active && ["consultor", "consultor_externo", "gestor", "admin"].includes(p.role))
        .map((p) => {
          const own = <T extends { consultor_id: string | null }>(l: T[]) => l.filter((r) => r.consultor_id === p.id);
          const cot = own(cotas);
          const apo = own(apolices);
          const metasP = metas.filter((m) => m.consultor_id === p.id);
          const atingimento = metasP.length
            ? metasP.reduce((a, m) => a + Math.min(150, (realizadoMeta(m.tipo, p.id, rows) / Number(m.valor_meta)) * 100), 0) / metasP.length
            : null;
          return {
            p,
            cotas: cot.length,
            credito: sum(cot, (r) => r.valor_credito),
            apolices: apo.length,
            premio: sum(apo, (r) => r.premio_liquido),
            clientes: own(rows.clientes).length,
            receita: sum(own(comissoes), (r) => r.valor_corretora),
            atingimento,
          };
        })
        .filter((r) => r.receita > 0 || r.credito > 0 || r.premio > 0 || r.clientes > 0 || r.p.role === "consultor" || r.p.role === "consultor_externo")
        .sort((a, b) => b.receita - a.receita || b.credito + b.premio - (a.credito + a.premio) || b.clientes - a.clientes)
    : [];
  const podium = ranking.filter((r) => r.receita > 0 || r.credito > 0 || r.premio > 0).slice(0, 3);

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title="Metas & ranking"
        description={`Acompanhamento de ${monthLong(mes)}${ritmo !== null ? ` · ${pct(ritmo, 0)} do mês decorrido` : ""}`}
        actions={
          <>
            <MonthPicker value={mes} />
            {manage && (
              <ConfirmAction
                action={copiarMetasMesAnterior}
                id={mes}
                title="Copiar metas do mês anterior"
                message={`As metas de ${monthLong(addMonths(mes, -1))} serão copiadas para ${monthLong(mes)}. Metas já existentes neste mês não serão alteradas.`}
                confirmLabel="Copiar metas"
                label="Copiar do mês anterior"
                variant="secondary"
                size="md"
                danger={false}
                icon={<CopyPlus className="h-4 w-4" />}
              />
            )}
            {manage && <FormDrawerButton action={createMeta} fields={fields} hidden={{ periodo: mes }} title="Nova meta" description={monthLong(mes)} label="Nova meta" variant="accent" width="max-w-lg" />}
          </>
        }
      />

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
          <Target className="h-4 w-4" /> Metas da equipe
        </h2>
        {equipe.length === 0 ? (
          <Card>
            <EmptyState icon={<Target className="h-6 w-6" />} title="Nenhuma meta da equipe neste mês" description={manage ? "Cadastre uma meta geral ou copie as do mês anterior." : "A gestão ainda não definiu as metas deste mês."} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {equipe.map((m) => (
              <MetaCard key={m.id} meta={m} realizado={realizadoMeta(m.tipo, null, rows)} ritmo={ritmo} subtitle={backoffice ? "Toda a corretora" : "Sua contribuição para a meta da equipe"} manage={manageButtons(m)} />
            ))}
          </div>
        )}
      </section>

      {!backoffice && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
            <Medal className="h-4 w-4" /> Minhas metas
          </h2>
          {individuais.length === 0 ? (
            <Card>
              <EmptyState icon={<Medal className="h-6 w-6" />} title="Sem metas individuais" description="Você não tem metas individuais definidas para este mês." />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {individuais.map((m) => (
                <MetaCard key={m.id} meta={m} realizado={realizadoMeta(m.tipo, userId, rows)} ritmo={ritmo} />
              ))}
            </div>
          )}
        </section>
      )}

      {backoffice && (
        <>
          <section className="mt-8">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted">
              <Trophy className="h-4 w-4" /> Ranking de {monthLong(mes)}
            </h2>
            {podium.length === 0 ? (
              <Card>
                <EmptyState icon={<Trophy className="h-6 w-6" />} title="Sem produção no mês" description="O pódio aparece assim que houver vendas registradas." />
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="brand-gradient px-4 pb-0 pt-8 text-white sm:px-8">
                  <div className="mx-auto grid max-w-3xl grid-cols-3 items-end gap-3 sm:gap-6">
                    {[1, 0, 2].map((pos) => {
                      const r = podium[pos];
                      if (!r) return <div key={pos} />;
                      const medal = [
                        { ring: "ring-amber-300", bar: "from-amber-300 to-amber-500 text-amber-950", h: "h-28", label: "1º" },
                        { ring: "ring-slate-200", bar: "from-slate-100 to-slate-300 text-slate-800", h: "h-20", label: "2º" },
                        { ring: "ring-orange-300", bar: "from-orange-300 to-orange-500 text-orange-950", h: "h-14", label: "3º" },
                      ][pos];
                      return (
                        <div key={r.p.id} className="flex min-w-0 flex-col items-center text-center">
                          {pos === 0 && <Crown className="mb-1 h-6 w-6 text-amber-300" />}
                          <Avatar name={r.p.full_name} src={r.p.avatar_url} size={pos === 0 ? 64 : 52} className={cn("ring-4", medal.ring)} />
                          <p className="mt-2 w-full truncate text-sm font-semibold">{r.p.full_name || r.p.email}</p>
                          <p className="text-xs text-white/75">{brlShort(r.receita)} em comissão</p>
                          <div className={cn("mt-3 grid w-full place-items-center rounded-t-xl bg-gradient-to-b text-2xl font-black", medal.bar, medal.h)}>{medal.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>
            )}
          </section>

          <Card className="mt-6">
            <CardHeader icon={<Users className="h-4 w-4" />} title="Classificação completa" description="Ordenada pela comissão gerada para a corretora; desempate por produção" />
            {ranking.length === 0 ? (
              <EmptyState title="Nenhum consultor ativo" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="w-12">#</th>
                      <th>Consultor</th>
                      <th className="text-right">Cotas</th>
                      <th className="text-right">Crédito</th>
                      <th className="text-right">Apólices</th>
                      <th className="text-right">Prêmio</th>
                      <th className="text-right">Novos clientes</th>
                      <th className="text-right">Comissão gerada</th>
                      <th className="w-44">Metas individuais</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, i) => (
                      <tr key={r.p.id}>
                        <td className="font-bold text-muted">{i + 1}º</td>
                        <td>
                          <div className="flex items-center gap-3">
                            <Avatar name={r.p.full_name} src={r.p.avatar_url} size={32} />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold">{r.p.full_name || r.p.email}</span>
                              <span className="block text-xs text-muted">{ROLE_LABEL[r.p.role]}</span>
                            </span>
                          </div>
                        </td>
                        <td className="text-right tabular-nums">{num(r.cotas)}</td>
                        <td className="text-right tabular-nums">{brl(r.credito)}</td>
                        <td className="text-right tabular-nums">{num(r.apolices)}</td>
                        <td className="text-right tabular-nums">{brl(r.premio)}</td>
                        <td className="text-right tabular-nums">{num(r.clientes)}</td>
                        <td className="text-right font-semibold tabular-nums">{brl(r.receita)}</td>
                        <td>
                          {r.atingimento === null ? (
                            <span className="text-xs text-muted">Sem metas</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Progress value={r.atingimento} tone={r.atingimento >= 100 ? "green" : "brand"} className="flex-1" />
                              <span className="w-10 text-right text-xs font-semibold tabular-nums">{pct(r.atingimento, 0)}</span>
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

          <Card className="mt-6">
            <CardHeader icon={<Medal className="h-4 w-4" />} title="Metas individuais" description={`${num(individuais.length)} meta(s) em ${monthShort(mes)}`} />
            {individuais.length === 0 ? (
              <EmptyState icon={<Medal className="h-6 w-6" />} title="Nenhuma meta individual" description={manage ? "Use “Nova meta” e escolha um consultor." : undefined} />
            ) : (
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Consultor</th>
                        <th>Meta</th>
                        <th className="text-right">Alvo</th>
                        <th className="text-right">Realizado</th>
                        <th className="w-56">Atingido</th>
                        <th className="text-right">Faltam</th>
                        {manage && <th className="w-24" />}
                      </tr>
                    </thead>
                    <tbody>
                      {[...individuais]
                        .sort((a, b) => (profiles.get(a.consultor_id!)?.full_name ?? "").localeCompare(profiles.get(b.consultor_id!)?.full_name ?? ""))
                        .map((m) => {
                          const p = profiles.get(m.consultor_id!);
                          const real = realizadoMeta(m.tipo, m.consultor_id, rows);
                          const alvo = Number(m.valor_meta);
                          const perc = alvo ? (real / alvo) * 100 : 0;
                          const fmt = (v: number) => (isCountMeta(m.tipo) ? num(v) : brl(v));
                          return (
                            <tr key={m.id}>
                              <td>
                                <div className="flex items-center gap-2.5">
                                  <Avatar name={p?.full_name} src={p?.avatar_url} size={28} />
                                  <span className="truncate font-medium">{p?.full_name ?? "—"}</span>
                                </div>
                              </td>
                              <td className="text-sm">{optionLabel(META_TIPOS, m.tipo)}</td>
                              <td className="text-right tabular-nums">{fmt(alvo)}</td>
                              <td className="text-right font-semibold tabular-nums">{fmt(real)}</td>
                              <td>
                                <div className="flex items-center gap-2">
                                  <Progress value={perc} tone={perc >= 100 ? "green" : ritmo !== null && perc < ritmo ? "accent" : "brand"} className="flex-1" />
                                  <span className="w-10 text-right text-xs font-semibold tabular-nums">{pct(perc, 0)}</span>
                                </div>
                              </td>
                              <td className="text-right tabular-nums">{perc >= 100 ? <Badge tone="green">Batida</Badge> : fmt(alvo - real)}</td>
                              {manage && (
                                <td>
                                  <div className="flex justify-end">{manageButtons(m)}</div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            )}
          </Card>
        </>
      )}
    </>
  );
}
