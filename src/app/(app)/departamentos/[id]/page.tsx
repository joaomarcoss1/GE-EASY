import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlarmClock, ArrowLeft, BarChart3, CalendarClock, ExternalLink, Gavel, ListChecks, PieChart, Power, Scale, UserPlus, Users } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { getProfileMap, userOptions } from "@/lib/data";
import { AUDIENCIA_TIPOS, PRAZO_STATUS, PRIORIDADES, PROCESSO_AREAS, PROCESSO_FASES, PROCESSO_RISCO, PROCESSO_STATUS, ROLE_LABEL, type Option } from "@/lib/constants";
import { brl, brlShort, dateTime, num, todayISO } from "@/lib/format";
import type { AppRole, Departamento, DepartamentoMembro, Tarefa } from "@/lib/types";
import { addMembro, removeMembro, toggleDepartamentoAtivo, updateDepartamento, updateMembroFuncao } from "@/lib/actions/departamentos";
import { createTarefa, setTarefaStatus, updateTarefa } from "@/lib/actions/tarefas";
import { isUuid } from "@/lib/actions/utils";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkTabs } from "@/components/ui/tabs";
import { LinkButton } from "@/components/ui/button";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DonutChart, HBarChart } from "@/components/dashboard/charts";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { addDays, spStartOf, sum } from "@/components/dashboard/periods";
import { depSigla, depTone } from "@/components/departamentos/tone";
import { demandaFields, departamentoFields, membroFields } from "@/components/departamentos/fields";
import { DemandasBoard, type DemandaItem } from "@/components/departamentos/demandas-board";
import { EquipeList, type MembroItem } from "@/components/departamentos/equipe-list";
import { DueChip } from "@/components/juridico/due-chip";

export const metadata: Metadata = { title: "Departamento" };

type Num = number | string;
type Ref<T> = T | T[] | null;
const one = <T,>(r: Ref<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

interface ProcRow {
  id: string;
  titulo: string;
  numero_cnj: string | null;
  numero_interno: string | null;
  area: string;
  fase: string;
  status: string;
  risco: string | null;
  valor_provisionado: Num | null;
  responsavel_id: string | null;
  cliente_id: string | null;
  clientes: Ref<{ nome: string }>;
  updated_at: string;
}
interface PrazoRow {
  id: string;
  descricao: string;
  data_fim: string;
  fatal: boolean;
  prioridade: string;
  processo_id: string | null;
  responsavel_id: string | null;
  processos: Ref<{ titulo: string; numero_cnj: string | null }>;
}
interface AudRow {
  id: string;
  tipo: string;
  data_hora: string;
  modalidade: string;
  local: string | null;
  processo_id: string;
  responsavel_id: string | null;
  processos: Ref<{ titulo: string }>;
}

const TABS = ["geral", "processos", "prazos", "demandas", "equipe"] as const;
type Tab = (typeof TABS)[number];
const ATIVOS = ["ativo", "suspenso"];

function LoadBar({ parts, max }: { parts: { value: number; cls: string; label: string }[]; max: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div className="flex h-2 w-full min-w-[120px] gap-0.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
      {total > 0 && parts.map((p) => (p.value ? <div key={p.label} className={cn("h-full", p.cls)} style={{ width: `${(p.value / Math.max(max, 1)) * 100}%` }} /> : null))}
    </div>
  );
}

export default async function DepartamentoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("departamentos.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "geral";
  const manager = isManagerRole(profile.role);
  const supabase = await createClient();

  const { data: depRow } = await supabase.from("departamentos").select("id, nome, sigla, descricao, cor, responsavel_id, ativo, tipo").eq("id", id).maybeSingle();
  if (!depRow) notFound();
  const dep = depRow as Departamento;

  const today = todayISO();
  const nowIso = new Date().toISOString();
  const in7Iso = new Date(spStartOf(addDays(today, 8))).toISOString();

  const [membrosRes, processos, prazosRes, audRes, openRes, doneRes, profiles, users] = await Promise.all([
    supabase.from("departamento_membros").select("departamento_id, user_id, funcao").eq("departamento_id", id),
    fetchAll<ProcRow>((f, t) =>
      supabase
        .from("processos")
        .select("id, titulo, numero_cnj, numero_interno, area, fase, status, risco, valor_provisionado, responsavel_id, cliente_id, clientes(nome), updated_at")
        .eq("departamento_id", id)
        .order("updated_at", { ascending: false })
        .order("id")
        .range(f, t),
    ),
    supabase
      .from("prazos")
      .select("id, descricao, data_fim, fatal, prioridade, processo_id, responsavel_id, processos(titulo, numero_cnj)")
      .eq("departamento_id", id)
      .eq("status", "pendente")
      .order("data_fim")
      .limit(500),
    supabase
      .from("audiencias")
      .select("id, tipo, data_hora, modalidade, local, processo_id, responsavel_id, processos!inner(titulo, departamento_id)")
      .eq("processos.departamento_id", id)
      .in("status", ["agendada", "redesignada"])
      .gte("data_hora", nowIso)
      .order("data_hora")
      .limit(100),
    supabase.from("tarefas").select("*").eq("departamento_id", id).neq("status", "concluida").order("vencimento", { ascending: true, nullsFirst: false }).limit(500),
    supabase.from("tarefas").select("*").eq("departamento_id", id).eq("status", "concluida").order("concluida_em", { ascending: false }).limit(20),
    getProfileMap(),
    userOptions(),
  ]);

  const membrosRaw = (membrosRes.data ?? []) as DepartamentoMembro[];
  const prazos = (prazosRes.data ?? []) as PrazoRow[];
  const audiencias = (audRes.data ?? []) as unknown as AudRow[];
  const openTarefas = (openRes.data ?? []) as Tarefa[];
  const doneTarefas = (doneRes.data ?? []) as Tarefa[];

  // Responsável principal sempre aparece na equipe.
  const membros: DepartamentoMembro[] = [...membrosRaw];
  if (dep.responsavel_id && !membros.some((m) => m.user_id === dep.responsavel_id)) {
    membros.unshift({ departamento_id: id, user_id: dep.responsavel_id, funcao: "responsavel" });
  }
  const isResp = dep.responsavel_id === userId || membros.some((m) => m.user_id === userId && m.funcao === "responsavel");
  const canManageTeam = manager || isResp;
  const canAssign = manager || isResp;

  const nome = (uid: string | null) => {
    if (!uid) return "—";
    const p = profiles.get(uid);
    return p?.full_name || p?.email || "Usuário";
  };

  const ativos = processos.filter((p) => ATIVOS.includes(p.status));
  const vencidos = prazos.filter((p) => p.data_fim < today);
  const aud7 = audiencias.filter((a) => a.data_hora < in7Iso);
  const atrasadas = openTarefas.filter((t) => t.vencimento && t.vencimento < today);
  const provisionado = sum(ativos, (p) => p.valor_provisionado);
  const resp = dep.responsavel_id ? profiles.get(dep.responsavel_id) : undefined;
  const tone = depTone(dep.cor);

  // ------------------------------------------------------------------ Equipe e carga
  const membroItems: MembroItem[] = membros
    .map((m) => {
      const p = profiles.get(m.user_id);
      const prz = prazos.filter((x) => x.responsavel_id === m.user_id);
      return {
        user_id: m.user_id,
        nome: p?.full_name || p?.email || "Usuário",
        email: p?.email ?? "",
        avatar: p?.avatar_url ?? null,
        papel: p ? (ROLE_LABEL[p.role as AppRole] ?? p.role) : "—",
        funcao: m.funcao,
        principal: m.user_id === dep.responsavel_id,
        processos: ativos.filter((x) => x.responsavel_id === m.user_id).length,
        prazos: prz.length,
        vencidos: prz.filter((x) => x.data_fim < today).length,
        tarefas: openTarefas.filter((x) => x.responsavel_id === m.user_id).length,
      };
    })
    .sort((a, b) => Number(b.principal) - Number(a.principal) || Number(b.funcao === "responsavel") - Number(a.funcao === "responsavel") || a.nome.localeCompare(b.nome));
  const cargaMax = Math.max(1, ...membroItems.map((m) => m.processos + m.prazos + m.tarefas));
  const memberIds = new Set(membroItems.map((m) => m.user_id));
  const memberOptions: Option[] = membroItems.map((m) => ({ value: m.user_id, label: m.nome }));
  const nonMemberOptions = users.filter((u) => !memberIds.has(u.value));

  // ------------------------------------------------------------------ Gráficos
  const porFase = PROCESSO_FASES.map((f) => {
    const n = ativos.filter((p) => p.fase === f.value).length;
    return { label: f.label, value: n, display: num(n), detail: "Processos" };
  }).filter((d) => d.value > 0);
  const porArea = PROCESSO_AREAS.map((a) => {
    const n = ativos.filter((p) => p.area === a.value).length;
    return { label: a.label, value: n, display: num(n) };
  });

  // ------------------------------------------------------------------ Demandas
  const procOptions: Option[] = ativos.map((p) => ({ value: p.id, label: p.numero_cnj ? `${p.titulo} · ${p.numero_cnj}` : p.titulo }));
  const procTitulo = new Map(processos.map((p) => [p.id, p.titulo]));
  const toDemanda = (t: Tarefa): DemandaItem => {
    const p = t.responsavel_id ? profiles.get(t.responsavel_id) : undefined;
    return {
      id: t.id,
      titulo: t.titulo,
      descricao: t.descricao,
      status: t.status,
      prioridade: t.prioridade,
      vencimento: t.vencimento,
      responsavel_id: t.responsavel_id,
      responsavel_nome: p ? p.full_name || p.email : null,
      responsavel_avatar: p?.avatar_url ?? null,
      processo_id: t.processo_id,
      processo_titulo: t.processo_id ? (procTitulo.get(t.processo_id) ?? null) : null,
      cliente_id: t.cliente_id,
      departamento_id: t.departamento_id,
      canEdit: manager || isResp || t.responsavel_id === userId || t.created_by === userId,
    };
  };
  const demandas = [...openTarefas, ...doneTarefas].map(toDemanda);

  const statusFiltro = sp.status === "todos" ? "todos" : sp.status === "encerrados" ? "encerrados" : "ativos";
  const processosLista =
    statusFiltro === "todos" ? processos : statusFiltro === "encerrados" ? processos.filter((p) => !ATIVOS.includes(p.status)) : ativos;

  const base = `/departamentos/${id}`;
  const depValues = { nome: dep.nome, sigla: dep.sigla, descricao: dep.descricao, cor: dep.cor, responsavel_id: dep.responsavel_id, tipo: dep.tipo };

  return (
    <>
      <Link href="/departamentos" className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Departamentos
      </Link>
      <PageHeader
        eyebrow="Departamento"
        title={
          <span className="flex items-center gap-3">
            <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[11px] font-bold tracking-wide shadow-sm", tone.chip)}>{depSigla(dep)}</span>
            <span className="truncate">{dep.nome}</span>
            {!dep.ativo && <Badge tone="slate">Inativo</Badge>}
          </span>
        }
        description={dep.descricao ?? undefined}
        actions={
          <>
            {tab === "demandas" && (
              <FormDrawerButton
                action={createTarefa}
                fields={demandaFields({ processos: procOptions, membros: memberOptions, canAssign, withStatus: false })}
                values={{ prioridade: "media" }}
                hidden={{ departamento_id: id }}
                title="Nova demanda"
                description={dep.nome}
                label="Nova demanda"
                variant="accent"
                width="max-w-lg"
                submitLabel="Criar demanda"
                defaultOpen={sp.novo === "1"}
              />
            )}
            {manager && (
              <>
                <FormDrawerButton
                  action={updateDepartamento}
                  fields={departamentoFields(users)}
                  values={depValues}
                  hidden={{ id }}
                  title="Editar departamento"
                  label="Editar"
                  icon="edit"
                  variant="secondary"
                  width="max-w-lg"
                  submitLabel="Salvar alterações"
                />
                <ConfirmAction
                  action={toggleDepartamentoAtivo}
                  id={id}
                  title={dep.ativo ? "Desativar departamento?" : "Reativar departamento?"}
                  message={
                    dep.ativo
                      ? "O departamento deixa de aparecer nas listas de seleção. Processos, prazos e demandas vinculados são mantidos."
                      : "O departamento volta a aparecer nas listas de seleção."
                  }
                  confirmLabel={dep.ativo ? "Desativar" : "Reativar"}
                  label={dep.ativo ? "Desativar" : "Reativar"}
                  variant="secondary"
                  size="sm"
                  danger={dep.ativo}
                  icon={<Power className="h-4 w-4" />}
                />
              </>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          {resp ? <Avatar name={resp.full_name} src={resp.avatar_url} size={28} /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-muted"><Users className="h-3.5 w-3.5" /></span>}
          <span className="text-muted">Responsável:</span>
          <span className="font-medium">{resp ? resp.full_name || resp.email : "não definido"}</span>
        </div>
        <span className="text-muted">
          <strong className="text-fg">{num(membroItems.length)}</strong> pessoa(s) na equipe
        </span>
        {provisionado > 0 && (
          <span className="text-muted">
            Provisionado: <strong className="text-fg">{brl(provisionado)}</strong>
          </span>
        )}
        {isResp && <Badge tone="accent">Você é responsável</Badge>}
      </div>

      <LinkTabs
        base={base}
        active={tab}
        tabs={[
          { key: "geral", label: "Visão geral" },
          { key: "processos", label: "Processos", count: ativos.length },
          { key: "prazos", label: "Prazos", count: prazos.length },
          { key: "demandas", label: "Demandas", count: openTarefas.length },
          { key: "equipe", label: "Equipe", count: membroItems.length },
        ]}
      />

      {tab === "geral" && (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard label="Processos ativos" value={num(ativos.length)} icon={<Scale className="h-5 w-5" />} hint={`${num(ativos.filter((p) => p.status === "suspenso").length)} suspenso(s) · ${num(processos.length)} no total`} />
            <StatCard
              label="Prazos pendentes"
              value={num(prazos.length)}
              icon={<AlarmClock className="h-5 w-5" />}
              tone={vencidos.length ? "accent" : "green"}
              hint={vencidos.length ? <span className="font-semibold text-red-600 dark:text-red-400">{num(vencidos.length)} vencido(s) sem baixa</span> : "nenhum vencido"}
            />
            <StatCard label="Audiências em 7 dias" value={num(aud7.length)} icon={<Gavel className="h-5 w-5" />} tone="amber" hint={`${num(audiencias.length)} agendada(s) no total`} />
            <StatCard
              label="Demandas abertas"
              value={num(openTarefas.length)}
              icon={<ListChecks className="h-5 w-5" />}
              tone="green"
              hint={atrasadas.length ? <span className="font-semibold text-red-600 dark:text-red-400">{num(atrasadas.length)} atrasada(s)</span> : "nenhuma atrasada"}
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader icon={<BarChart3 className="h-4 w-4" />} title="Processos por fase" description="Processos ativos e suspensos" />
              <CardBody>
                <HBarChart data={porFase} labelWidth={170} emptyText="Nenhum processo ativo no departamento." />
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<PieChart className="h-4 w-4" />} title="Processos por área" description="Distribuição da carteira ativa" />
              <CardBody>
                <DonutChart data={porArea} centerLabel="Processos" centerValue={num(ativos.length)} money={false} />
              </CardBody>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader
              icon={<Users className="h-4 w-4" />}
              title="Carga por membro"
              description="Processos sob responsabilidade, prazos pendentes e demandas abertas"
              action={
                <span className="hidden items-center gap-3 text-[11px] text-muted sm:flex">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand-500" />Processos</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-accent-500" />Prazos</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Demandas</span>
                </span>
              }
            />
            {membroItems.length === 0 ? (
              <EmptyState icon={<Users className="h-6 w-6" />} title="Equipe vazia" description="Adicione membros na aba Equipe." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Membro</th>
                      <th className="text-right">Processos</th>
                      <th className="text-right">Prazos</th>
                      <th className="text-right">Demandas</th>
                      <th className="w-[35%]">Carga</th>
                    </tr>
                  </thead>
                  <tbody>
                    {membroItems.map((m) => (
                      <tr key={m.user_id}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={m.nome} src={m.avatar} size={28} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{m.nome}</p>
                              <p className="text-[11px] text-muted">{m.funcao === "responsavel" ? "Responsável" : "Membro"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="text-right tabular-nums">{num(m.processos)}</td>
                        <td className="text-right tabular-nums">
                          {num(m.prazos)}
                          {m.vencidos > 0 && <span className="ml-1 text-[11px] font-semibold text-red-600 dark:text-red-400">({m.vencidos} venc.)</span>}
                        </td>
                        <td className="text-right tabular-nums">{num(m.tarefas)}</td>
                        <td>
                          <LoadBar
                            max={cargaMax}
                            parts={[
                              { label: "Processos", value: m.processos, cls: "bg-brand-500 dark:bg-brand-400" },
                              { label: "Prazos", value: m.prazos, cls: "bg-accent-500" },
                              { label: "Demandas", value: m.tarefas, cls: "bg-emerald-500" },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                icon={<AlarmClock className="h-4 w-4" />}
                title="Prazos mais urgentes"
                action={
                  <Link href={`${base}?tab=prazos`} className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Ver todos
                  </Link>
                }
              />
              {prazos.length === 0 ? (
                <EmptyState icon={<AlarmClock className="h-6 w-6" />} title="Nenhum prazo pendente" />
              ) : (
                <ul className="divide-y divide-line">
                  {prazos.slice(0, 6).map((p) => (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                      <DueChip data={p.data_fim} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.descricao}</p>
                        <p className="truncate text-xs text-muted">
                          {one(p.processos)?.titulo ?? "Prazo administrativo"} · {nome(p.responsavel_id)}
                        </p>
                      </div>
                      {p.fatal && <Badge tone="red">Fatal</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader
                icon={<Gavel className="h-4 w-4" />}
                title="Próximas audiências"
                action={
                  <Link href="/audiencias" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                    Audiências
                  </Link>
                }
              />
              {audiencias.length === 0 ? (
                <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="Nenhuma audiência agendada" />
              ) : (
                <ul className="divide-y divide-line">
                  {audiencias.slice(0, 6).map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-1 self-stretch rounded-full bg-accent-500/80" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/processos/${a.processo_id}`} className="block truncate text-sm font-medium hover:text-brand-600">
                          {one(a.processos)?.titulo ?? "Processo"}
                        </Link>
                        <p className="truncate text-xs text-muted">
                          {dateTime(a.data_hora)} · {optionLabel(AUDIENCIA_TIPOS, a.tipo)}
                          {a.local ? ` · ${a.local}` : a.modalidade === "virtual" ? " · virtual" : ""}
                        </p>
                      </div>
                      <span className="hidden text-xs text-muted sm:block">{nome(a.responsavel_id)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      {tab === "processos" && (
        <Card>
          <CardHeader
            icon={<Scale className="h-4 w-4" />}
            title="Processos do departamento"
            description={`${num(processosLista.length)} processo(s) · provisionado ${brlShort(sum(processosLista, (p) => p.valor_provisionado))}`}
            action={
              <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-surface-2 p-1">
                {(
                  [
                    ["ativos", "Em andamento"],
                    ["encerrados", "Encerrados"],
                    ["todos", "Todos"],
                  ] as const
                ).map(([k, l]) => (
                  <Link
                    key={k}
                    href={k === "ativos" ? `${base}?tab=processos` : `${base}?tab=processos&status=${k}`}
                    scroll={false}
                    className={cn("rounded-lg px-3 py-1 text-xs font-medium transition", statusFiltro === k ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
                  >
                    {l}
                  </Link>
                ))}
              </div>
            }
          />
          {processosLista.length === 0 ? (
            <EmptyState icon={<Scale className="h-6 w-6" />} title="Nenhum processo" description="Não há processos deste departamento com o filtro selecionado." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Processo</th>
                    <th>Cliente</th>
                    <th>Área</th>
                    <th>Fase</th>
                    <th>Situação</th>
                    <th>Risco</th>
                    <th>Responsável</th>
                    <th className="text-right">Provisionado</th>
                  </tr>
                </thead>
                <tbody>
                  {processosLista.slice(0, 300).map((p) => (
                    <tr key={p.id}>
                      <td className="max-w-[320px]">
                        <Link href={`/processos/${p.id}`} className="block truncate font-medium hover:text-brand-600">
                          {p.titulo}
                        </Link>
                        <p className="truncate font-mono text-[11px] text-muted">{p.numero_cnj || p.numero_interno || "sem número"}</p>
                      </td>
                      <td className="max-w-[180px] truncate text-sm">
                        {p.cliente_id ? (
                          <Link href={`/clientes/${p.cliente_id}`} className="hover:text-brand-600">
                            {one(p.clientes)?.nome ?? "Cliente"}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-sm">{optionLabel(PROCESSO_AREAS, p.area)}</td>
                      <td>
                        <StatusBadge options={PROCESSO_FASES} value={p.fase} />
                      </td>
                      <td>
                        <StatusBadge options={PROCESSO_STATUS} value={p.status} />
                      </td>
                      <td>{p.risco ? <StatusBadge options={PROCESSO_RISCO} value={p.risco} /> : <span className="text-xs text-muted">Não avaliado</span>}</td>
                      <td className="whitespace-nowrap text-sm">{nome(p.responsavel_id)}</td>
                      <td className="text-right tabular-nums">{p.valor_provisionado == null ? "—" : brl(p.valor_provisionado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {processosLista.length > 300 && <p className="px-5 py-3 text-xs text-muted">Exibindo os 300 mais recentes de {num(processosLista.length)}. Use a tela de Processos para filtrar.</p>}
            </div>
          )}
        </Card>
      )}

      {tab === "prazos" && (
        <Card>
          <CardHeader
            icon={<AlarmClock className="h-4 w-4" />}
            title="Prazos pendentes"
            description={vencidos.length ? `${num(prazos.length)} pendente(s) · ${num(vencidos.length)} vencido(s) sem baixa` : `${num(prazos.length)} pendente(s), ordenados pelo vencimento`}
            action={
              <LinkButton href="/prazos" variant="secondary" size="sm">
                <ExternalLink className="h-3.5 w-3.5" /> Gerenciar prazos
              </LinkButton>
            }
          />
          {prazos.length === 0 ? (
            <EmptyState icon={<AlarmClock className="h-6 w-6" />} title="Nenhum prazo pendente" description="Todos os prazos deste departamento estão em dia." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Vencimento</th>
                    <th>Prazo</th>
                    <th>Processo</th>
                    <th>Responsável</th>
                    <th>Prioridade</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {prazos.map((p) => {
                    const late = p.data_fim < today;
                    const proc = one(p.processos);
                    return (
                      <tr key={p.id} className={cn(late && "bg-red-50/60 dark:bg-red-950/20")}>
                        <td>
                          <DueChip data={p.data_fim} />
                        </td>
                        <td className="max-w-[300px]">
                          <p className={cn("truncate font-medium", late && "text-red-700 dark:text-red-300")}>{p.descricao}</p>
                          {p.fatal && <span className="text-[11px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Prazo fatal</span>}
                        </td>
                        <td className="max-w-[260px]">
                          {p.processo_id ? (
                            <Link href={`/processos/${p.processo_id}`} className="block truncate text-sm hover:text-brand-600">
                              {proc?.titulo ?? "Processo"}
                              {proc?.numero_cnj && <span className="block truncate font-mono text-[11px] text-muted">{proc.numero_cnj}</span>}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted">Administrativo</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-sm">{nome(p.responsavel_id)}</td>
                        <td>
                          <StatusBadge options={PRIORIDADES} value={p.prioridade} />
                        </td>
                        <td>{late ? <Badge tone="red" dot>Vencido</Badge> : <StatusBadge options={PRAZO_STATUS} value="pendente" />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "demandas" && (
        <>
          <p className="mb-4 text-sm text-muted">
            Arraste os cartões entre as colunas ou use os botões para mudar o status.{" "}
            {!canAssign && "Você pode criar demandas para si; a distribuição para outros membros é feita pelo responsável do departamento."}
          </p>
          <DemandasBoard
            items={demandas}
            today={today}
            editFields={demandaFields({ processos: procOptions, membros: memberOptions, canAssign, withStatus: true })}
            actions={{ setStatus: setTarefaStatus, update: updateTarefa }}
          />
          {doneTarefas.length >= 20 && <p className="mt-3 text-xs text-muted">Concluídas: exibindo as 20 mais recentes.</p>}
        </>
      )}

      {tab === "equipe" && (
        <Card>
          <CardHeader
            icon={<Users className="h-4 w-4" />}
            title="Equipe"
            description={canManageTeam ? "Adicione ou remova pessoas e defina quem coordena o departamento." : "Pessoas com acesso aos processos, prazos e demandas do departamento."}
            action={
              canManageTeam && nonMemberOptions.length > 0 ? (
                <FormDrawerButton
                  action={addMembro}
                  fields={membroFields(nonMemberOptions)}
                  values={{ funcao: "membro" }}
                  hidden={{ departamento_id: id }}
                  title="Adicionar membro"
                  description={dep.nome}
                  label="Adicionar"
                  variant="outline"
                  size="sm"
                  width="max-w-md"
                  submitLabel="Adicionar"
                />
              ) : undefined
            }
          />
          {membroItems.length === 0 ? (
            <EmptyState icon={<UserPlus className="h-6 w-6" />} title="Nenhum membro" description="Este departamento ainda não tem equipe." />
          ) : (
            <EquipeList
              membros={membroItems}
              canManage={canManageTeam}
              actions={{ setFuncao: updateMembroFuncao.bind(null, id), remove: removeMembro.bind(null, id) }}
            />
          )}
          {canManageTeam && (
            <p className="border-t border-line px-5 py-3 text-xs text-muted">
              O responsável principal (definido no cadastro do departamento) é marcado com a coroa e só pode ser alterado pela gestão.
            </p>
          )}
        </Card>
      )}
    </>
  );
}
