import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, ListChecks, Sun } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { clienteOptions, getProfileMap, userOptions } from "@/lib/data";
import { PRIORIDADES, type Option } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { Tarefa } from "@/lib/types";
import { createTarefa, deleteTarefa, toggleTarefa, updateTarefa } from "@/lib/actions/tarefas";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { FilterSelect } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { TarefasBoard, type TarefaItem } from "@/components/tarefas/tarefas-board";
import { tarefaFields } from "@/components/tarefas/fields";
import { addDays, spStartOfDay, weekday } from "@/components/agenda/date-utils";

export const metadata: Metadata = { title: "Tarefas" };

const UUID = /^[0-9a-f-]{36}$/i;
const PRIO_VALUES = PRIORIDADES.map((p) => p.value);

export default async function TarefasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireSession();
  const sp = await searchParams;
  const manager = isManagerRole(profile.role);
  const resp = manager && sp.resp && UUID.test(sp.resp) ? sp.resp : undefined;
  const prioridade = sp.prioridade && PRIO_VALUES.includes(sp.prioridade) ? sp.prioridade : undefined;
  const today = todayISO();
  const weekStart = addDays(today, -((weekday(today) + 6) % 7)); // segunda-feira

  const supabase = await createClient();
  let openQ = supabase.from("tarefas").select("*", { count: "exact" }).neq("status", "concluida").order("vencimento", { ascending: true, nullsFirst: false }).limit(500);
  let doneQ = supabase.from("tarefas").select("*").eq("status", "concluida").order("concluida_em", { ascending: false }).limit(20);
  let weekQ = supabase.from("tarefas").select("id", { count: "exact", head: true }).eq("status", "concluida").gte("concluida_em", spStartOfDay(weekStart));
  if (resp) {
    openQ = openQ.eq("responsavel_id", resp);
    doneQ = doneQ.eq("responsavel_id", resp);
    weekQ = weekQ.eq("responsavel_id", resp);
  }
  if (prioridade) {
    openQ = openQ.eq("prioridade", prioridade);
    doneQ = doneQ.eq("prioridade", prioridade);
    weekQ = weekQ.eq("prioridade", prioridade);
  }

  const [{ data: openRows, count: openCount }, { data: doneRows }, { count: weekCount }, profiles, clientes, users] = await Promise.all([
    openQ,
    doneQ,
    weekQ,
    getProfileMap(),
    clienteOptions(),
    manager ? userOptions() : Promise.resolve([] as Option[]),
  ]);
  const open = (openRows ?? []) as Tarefa[];
  const done = (doneRows ?? []) as Tarefa[];

  const clienteIds = [...new Set([...open, ...done].map((t) => t.cliente_id).filter((v): v is string => !!v))];
  const clienteNomes = new Map<string, string>();
  if (clienteIds.length) {
    const { data } = await supabase.from("clientes").select("id, nome").in("id", clienteIds);
    for (const c of data ?? []) clienteNomes.set(c.id as string, c.nome as string);
  }

  const toItem = (t: Tarefa): TarefaItem => ({
    id: t.id,
    titulo: t.titulo,
    descricao: t.descricao,
    status: t.status,
    prioridade: t.prioridade,
    vencimento: t.vencimento,
    cliente_id: t.cliente_id,
    cliente_nome: t.cliente_id ? (clienteNomes.get(t.cliente_id) ?? null) : null,
    responsavel_id: t.responsavel_id,
    responsavel_nome: t.responsavel_id ? (profiles.get(t.responsavel_id)?.full_name ?? null) : null,
    concluida_em: t.concluida_em,
    canDelete: manager || t.created_by === userId,
  });

  const atrasadas = open.filter((t) => t.vencimento && t.vencimento < today).length;
  const hoje = open.filter((t) => t.vencimento === today).length;
  const urgentes = open.filter((t) => t.prioridade === "urgente").length;

  const novoValues =
    sp.novo === "1"
      ? { prioridade: "media", vencimento: today, ...(sp.cliente_id && UUID.test(sp.cliente_id) ? { cliente_id: sp.cliente_id } : {}) }
      : { prioridade: "media", vencimento: today };

  return (
    <>
      <PageHeader
        eyebrow="Principal"
        title="Tarefas"
        description="Acompanhe follow-ups, pendências de documentos e próximos passos com os clientes."
        actions={
          <FormDrawerButton
            action={createTarefa}
            fields={tarefaFields(clientes, users, manager, false)}
            values={novoValues}
            title="Nova tarefa"
            label="Nova tarefa"
            variant="accent"
            width="max-w-lg"
            submitLabel="Criar tarefa"
            defaultOpen={sp.novo === "1"}
          />
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Pendentes" value={openCount ?? open.length} hint={urgentes ? `${urgentes} urgente(s)` : "em aberto"} icon={<ListChecks className="h-5 w-5" />} />
        <StatCard label="Atrasadas" value={atrasadas} hint={atrasadas ? "precisam de atenção" : "nenhuma atrasada"} icon={<AlertTriangle className="h-5 w-5" />} tone={atrasadas ? "accent" : "green"} />
        <StatCard label="Para hoje" value={hoje} hint="vencem hoje" icon={<Sun className="h-5 w-5" />} tone="amber" />
        <StatCard label="Concluídas na semana" value={weekCount ?? 0} hint="desde segunda-feira" icon={<CheckCircle2 className="h-5 w-5" />} tone="green" />
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        {manager && <FilterSelect param="resp" options={users} allLabel="Todos os responsáveis" />}
        <FilterSelect param="prioridade" options={PRIORIDADES} allLabel="Todas as prioridades" />
        {(openCount ?? 0) > open.length && <span className="text-xs text-muted sm:ml-auto">Exibindo as {open.length} primeiras tarefas abertas.</span>}
      </div>

      <TarefasBoard
        open={open.map(toItem)}
        done={done.map(toItem)}
        today={today}
        showResp={manager}
        editFields={tarefaFields(clientes, users, manager, true)}
        actions={{ toggle: toggleTarefa, update: updateTarefa, remove: deleteTarefa }}
        filtered={!!(resp || prioridade)}
      />
    </>
  );
}
