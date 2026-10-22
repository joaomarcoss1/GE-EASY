import type { Metadata } from "next";
import { Clock, Receipt, Timer, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, getProfileMap, processoOptions } from "@/lib/data";
import { date, todayISO } from "@/lib/format";
import { deleteHoras, faturarHoras, lancarHoras } from "@/lib/actions/horas";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { SegmentTabs } from "@/components/ui/filters";
import { HorasTimer } from "@/components/horas/timer";
import { EquipeHorasTable, type HoraRow } from "@/components/horas/equipe-table";

export const metadata: Metadata = { title: "Controle de horas" };

const fmt = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export default async function HorasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("horas.lancar");
  const sp = await searchParams;
  const gerir = can(profile, "horas.gerir");
  const aba = gerir && sp.aba === "equipe" ? "equipe" : "minhas";
  const hoje = todayISO();
  const dow = (new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7; // segunda = 0
  const semanaIni = addDays(hoje, -dow);
  const ini30 = addDays(hoje, -30);
  const supabase = await createClient();

  const [minhasRes, equipeRes, clientes, processos, profiles] = await Promise.all([
    supabase.from("horas_lancamentos").select("*, clientes(nome), processos(titulo)").eq("user_id", userId).gte("data", ini30).order("data", { ascending: false }).order("created_at", { ascending: false }).limit(500),
    gerir ? supabase.from("horas_lancamentos").select("*, clientes(nome), processos(titulo)").gte("data", ini30).order("data", { ascending: false }).limit(2000) : Promise.resolve({ data: [] }),
    clienteOptions(),
    processoOptions(),
    getProfileMap(),
  ]);
  type H = { id: string; data: string; minutos: number; descricao: string; faturavel: boolean; faturado: boolean; user_id: string; clientes: { nome: string } | null; processos: { titulo: string } | null } & Record<string, unknown>;
  const minhas = (minhasRes.data ?? []) as unknown as H[];
  const equipe = (equipeRes.data ?? []) as unknown as H[];

  const fields: FieldDef[] = [
    { name: "data", label: "Data", type: "date", required: true, span: 2 },
    { name: "duracao", label: "Duração", placeholder: "1:30 ou 1,5", required: true, span: 2, help: "hh:mm ou horas decimais" },
    { name: "faturavel", label: "Faturável", type: "checkbox", span: 2 },
    { name: "descricao", label: "Atividade", type: "textarea", rows: 3, required: true, span: 6, placeholder: "Ex.: Elaboração de contestação, reunião com cliente…" },
    { name: "processo_id", label: "Processo", type: "select", options: processos, emptyOption: "—", span: 3 },
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, emptyOption: "Do processo", span: 3 },
    { name: "valor_hora", label: "Valor da hora (opcional)", type: "money", span: 3, help: "Se vazio, usa o do contrato" },
  ];

  const semana = minhas.filter((h) => h.data >= semanaIni);
  const minSemana = semana.reduce((a, h) => a + h.minutos, 0);
  const minHoje = minhas.filter((h) => h.data === hoje).reduce((a, h) => a + h.minutos, 0);
  const min30 = minhas.reduce((a, h) => a + h.minutos, 0);
  const pendFat = (gerir ? equipe : minhas).filter((h) => h.faturavel && !h.faturado).reduce((a, h) => a + h.minutos, 0);
  const porDia = new Map<string, H[]>();
  for (const h of minhas) porDia.set(h.data, [...(porDia.get(h.data) ?? []), h]);

  return (
    <>
      <PageHeader
        eyebrow="Escritório"
        title="Controle de horas"
        description="Registre o tempo dedicado a cada processo e cliente; o financeiro fatura as horas em um clique."
        actions={<FormDrawerButton action={lancarHoras} fields={fields} values={{ data: hoje, faturavel: true, processo_id: sp.processo_id ?? "" }} title="Lançar horas" label="Lançar horas" variant="accent" width="max-w-xl" defaultOpen={sp.novo === "1"} />}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Hoje" value={fmt(minHoje)} icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Nesta semana" value={fmt(minSemana)} icon={<Timer className="h-5 w-5" />} tone="accent" />
        <StatCard label="Últimos 30 dias" value={fmt(min30)} icon={<Users className="h-5 w-5" />} tone="green" />
        <StatCard label={gerir ? "Equipe: a faturar (30 dias)" : "A faturar (30 dias)"} value={fmt(pendFat)} icon={<Receipt className="h-5 w-5" />} tone="amber" />
      </div>
      <div className="mb-6">
        <HorasTimer action={lancarHoras} fields={fields} />
      </div>
      {gerir && (
        <div className="mb-5">
          <SegmentTabs param="aba" options={[{ value: "minhas", label: "Minhas horas" }, { value: "equipe", label: "Equipe e faturamento" }]} />
        </div>
      )}

      {aba === "minhas" ? (
        <Card>
          <CardHeader title="Meus lançamentos (últimos 30 dias)" icon={<Clock className="h-4 w-4" />} />
          {minhas.length === 0 ? (
            <EmptyState title="Nenhuma hora lançada" description="Use o cronômetro ou “Lançar horas” para registrar sua atividade." />
          ) : (
            <div>
              {[...porDia.entries()].map(([dia, list]) => (
                <div key={dia} className="border-b border-line last:border-0">
                  <div className="flex items-center justify-between bg-surface-2 px-5 py-2 text-xs font-semibold">
                    <span>{date(dia)}</span>
                    <span className="tabular-nums">{fmt(list.reduce((a, h) => a + h.minutos, 0))}</span>
                  </div>
                  <ul className="divide-y divide-line">
                    {list.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{h.descricao}</p>
                          <p className="truncate text-xs text-muted">{[h.processos?.titulo, h.clientes?.nome].filter(Boolean).join(" · ") || "Sem vínculo"}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {h.faturado ? <Badge tone="green">Faturada</Badge> : !h.faturavel && <Badge tone="slate">Não faturável</Badge>}
                          <span className="w-14 text-right font-semibold tabular-nums">{fmt(h.minutos)}</span>
                          {!h.faturado && (
                            <>
                              <FormDrawerButton action={lancarHoras} fields={fields} values={{ ...(h as Record<string, string>), duracao: `${Math.floor(h.minutos / 60)}:${String(h.minutos % 60).padStart(2, "0")}`, faturavel: h.faturavel, clientes: undefined, processos: undefined }} hidden={{ id: h.id }} title="Editar lançamento" icon="edit" size="icon" variant="ghost" width="max-w-xl" />
                              <ConfirmAction action={deleteHoras} id={h.id} title="Excluir lançamento?" />
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Horas da equipe (últimos 30 dias)" description="Selecione as horas faturáveis pendentes e gere a cobrança no financeiro" icon={<Users className="h-4 w-4" />} />
          {equipe.length === 0 ? (
            <EmptyState title="Nenhuma hora lançada pela equipe" />
          ) : (
            <EquipeHorasTable
              faturar={faturarHoras}
              rows={equipe.map(
                (h): HoraRow => ({
                  id: h.id,
                  data: h.data,
                  minutos: h.minutos,
                  descricao: h.descricao,
                  usuario: profiles.get(h.user_id)?.full_name ?? "—",
                  cliente: h.clientes?.nome ?? null,
                  processo: h.processos?.titulo ?? null,
                  faturavel: h.faturavel,
                  faturado: h.faturado,
                }),
              )}
            />
          )}
        </Card>
      )}
    </>
  );
}
