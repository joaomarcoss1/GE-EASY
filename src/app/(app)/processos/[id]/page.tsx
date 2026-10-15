import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  AlarmClock, ArrowLeft, Building2, CalendarClock, ExternalLink, FileSignature, FileText, Gavel, Landmark, ListChecks, Lock, Plus, Scale, Timer, Users, Wallet,
} from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, departamentoMap, departamentoOptions, getProfileMap, juridicoOptions } from "@/lib/data";
import {
  ANDAMENTO_TIPOS, INSTANCIAS, LANCAMENTO_STATUS, LANCAMENTO_TIPOS, PARTE_TIPOS, PRIORIDADES, PROCESSO_AREAS, PROCESSO_FASES,
  PROCESSO_POLO, PROCESSO_RISCO, PROCESSO_STATUS, TAREFA_STATUS, type Tone,
} from "@/lib/constants";
import { brl, date, dateTime, daysUntil, maskDocumento, relative, todayISO } from "@/lib/format";
import { parseCNJ } from "@/lib/juridico/cnj";
import type { Processo, ProcessoAndamento, ProcessoLancamento, ProcessoParte, Tarefa } from "@/lib/types";
import {
  addAndamento, deleteAndamento, deleteLancamento, deleteParte, deleteProcesso, saveLancamento, saveParte, setProcessoFaseStatus, updateProcesso,
} from "@/lib/actions/processos";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { LinkTabs } from "@/components/ui/tabs";
import { DocumentosPanel } from "@/components/documentos/documentos-panel";
import { DrivePastaButton } from "@/components/documentos/drive-pasta-button";
import { getDriveEscritorioStatus } from "@/components/documentos/google-status";
import { DatajudPanel } from "@/components/processos/datajud-panel";
import { podeConsultarDatajud } from "@/lib/juridico/datajud";
import { alternarMonitoramentoDatajud, sincronizarDatajud } from "@/lib/actions/integracoes";
import { registrarAcesso } from "@/lib/actions/utils";
import { PrazosPanel } from "@/components/prazos/prazos-panel";
import { AudienciasPanel } from "@/components/audiencias/audiencias-panel";
import { QuickStatus } from "@/components/processos/quick-status";
import { andamentoFields, lancamentoFields, parteFields, processoFields } from "@/components/processos/fields";

export const metadata: Metadata = { title: "Processo" };

const ENTRADAS = new Set(["honorarios_contratuais", "honorarios_sucumbenciais", "honorarios_exito", "acordo"]);

export default async function ProcessoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { profile } = await requirePermission("processos.view");
  const { id } = await params;
  const { tab = "andamentos" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: p } = await supabase.from("processos").select("*").eq("id", id).maybeSingle<Processo>();
  if (!p) notFound();
  const hoje = todayISO();

  const [
    { data: cliente },
    { data: andamentos },
    { data: partes },
    { data: lancamentos },
    { data: tarefas },
    { data: proxPrazo },
    { data: proxAud },
    { count: prazosPend },
    { count: audCount },
    { count: docCount },
    profiles,
    deps,
  ] = await Promise.all([
    p.cliente_id ? supabase.from("clientes").select("id, nome, documento").eq("id", p.cliente_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("processo_andamentos").select("*").eq("processo_id", id).order("data", { ascending: false }).order("data_hora", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(500),
    supabase.from("processo_partes").select("*").eq("processo_id", id).order("tipo"),
    supabase.from("processo_lancamentos").select("*").eq("processo_id", id).order("data", { ascending: false }),
    supabase.from("tarefas").select("*").eq("processo_id", id).order("vencimento", { ascending: true }).limit(50),
    supabase.from("prazos").select("descricao, data_fim, fatal").eq("processo_id", id).eq("status", "pendente").order("data_fim").limit(1).maybeSingle(),
    supabase.from("audiencias").select("tipo, data_hora").eq("processo_id", id).eq("status", "agendada").gte("data_hora", new Date().toISOString()).order("data_hora").limit(1).maybeSingle(),
    supabase.from("prazos").select("id", { count: "exact", head: true }).eq("processo_id", id).eq("status", "pendente"),
    supabase.from("audiencias").select("id", { count: "exact", head: true }).eq("processo_id", id),
    supabase.from("documentos").select("id", { count: "exact", head: true }).eq("processo_id", id),
    getProfileMap(),
    departamentoMap(),
  ]);

  const ands = (andamentos ?? []) as ProcessoAndamento[];
  const pts = (partes ?? []) as ProcessoParte[];
  const lcs = (lancamentos ?? []) as ProcessoLancamento[];
  const tfs = (tarefas ?? []) as Tarefa[];
  const dep = p.departamento_id ? deps.get(p.departamento_id) : null;
  const resp = p.responsavel_id ? profiles.get(p.responsavel_id) : null;
  const canWrite = can(profile.role, "processos.write");
  const canFin = can(profile.role, "processos.financeiro");
  const cnjInfo = p.numero_cnj ? parseCNJ(p.numero_cnj) : null;

  const ativos = lcs.filter((l) => l.status !== "cancelado");
  const entradas = ativos.filter((l) => ENTRADAS.has(l.tipo)).reduce((a, l) => a + Number(l.valor), 0);
  const saidas = ativos.filter((l) => !ENTRADAS.has(l.tipo) && l.tipo !== "condenacao").reduce((a, l) => a + Number(l.valor), 0);

  const [clientes, departamentos, juridico] = canWrite ? await Promise.all([clienteOptions(), departamentoOptions(), juridicoOptions()]) : [[], [], []];
  const prazoDias = proxPrazo ? daysUntil(proxPrazo.data_fim) : null;
  const drive = await getDriveEscritorioStatus();
  if (p.segredo_justica) await registrarAcesso("VISUALIZACAO_SIGILOSA", "processos", id, { aba: tab });

  return (
    <>
      <Link href="/processos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Processos
      </Link>

      <Card className="mb-6 overflow-hidden">
        <div className="brand-gradient relative px-6 pb-6 pt-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-semibold">{optionLabel(PROCESSO_AREAS, p.area)}</span>
                {dep && <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-semibold">{dep.nome}</span>}
                {p.segredo_justica && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/80 px-2.5 py-0.5 font-semibold">
                    <Lock className="h-3 w-3" /> Segredo de justiça
                  </span>
                )}
                {p.tags.map((t) => (
                  <span key={t} className="rounded-full bg-accent-500/80 px-2.5 py-0.5 font-semibold">{t}</span>
                ))}
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{p.titulo}</h1>
              <p className="mt-1 font-mono text-sm text-white/80">{p.numero_cnj ?? "Sem número CNJ"}{p.numero_interno ? ` · Pasta ${p.numero_interno}` : ""}</p>
              <p className="mt-1 text-sm text-white/70">
                {[p.classe, p.orgao, [p.comarca, p.uf].filter(Boolean).join("/"), p.tribunal ?? cnjInfo?.tribunal].filter(Boolean).join(" · ") || "Juízo não informado"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {p.link_autos && (
                <a href={p.link_autos} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
                  <ExternalLink className="h-4 w-4" /> Autos
                </a>
              )}
              {drive.ativo && <DrivePastaButton tipo="processo" id={id} variant="hero" />}
              {can(profile.role, "modelos.view") && (
                <Link href={`/modelos/gerar?processo_id=${id}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
                  <FileText className="h-4 w-4" /> Gerar documento
                </Link>
              )}
              {can(profile.role, "horas.lancar") && (
                <Link href={`/horas?novo=1&processo_id=${id}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
                  <Timer className="h-4 w-4" /> Lançar horas
                </Link>
              )}
              {can(profile.role, "contratos.write") && (
                <Link href={`/contratos?novo=1&processo_id=${id}${p.cliente_id ? `&cliente_id=${p.cliente_id}` : ""}`} className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
                  <FileSignature className="h-4 w-4" /> Novo contrato
                </Link>
              )}
              {canWrite && (
                <FormDrawerButton
                  action={updateProcesso}
                  fields={processoFields({ clientes, departamentos, juridico })}
                  values={{ ...p, instancia: String(p.instancia), tags: p.tags.join(", "), equipe: p.equipe }}
                  hidden={{ id }}
                  title="Editar processo"
                  label="Editar"
                  icon="edit"
                  variant="secondary"
                  width="max-w-3xl"
                />
              )}
              {can(profile.role, "processos.delete") && (
                <ConfirmAction action={deleteProcesso} id={id} title="Excluir processo?" message="Andamentos, partes, prazos, audiências e lançamentos deste processo também serão excluídos." redirectTo="/processos" variant="secondary" />
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-b border-line px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-muted">Cliente:</span>
              {cliente ? (
                <Link href={`/clientes/${cliente.id}`} className="font-semibold hover:text-brand-600">{cliente.nome}</Link>
              ) : (
                <span className="text-muted">—</span>
              )}
              <span className="text-xs text-muted">({optionLabel(PROCESSO_POLO, p.polo_cliente).split(" (")[0]})</span>
            </span>
            {p.parte_contraria && (
              <span>
                <span className="text-muted">Parte contrária:</span> <b className="font-semibold">{p.parte_contraria}</b>
              </span>
            )}
            <span className="flex items-center gap-2">
              <span className="text-muted">Responsável:</span>
              {resp ? (
                <>
                  <Avatar name={resp.full_name} src={resp.avatar_url} size={22} />
                  <b className="font-semibold">{resp.full_name}</b>
                </>
              ) : (
                "—"
              )}
            </span>
            {p.equipe.length > 0 && (
              <span className="flex items-center -space-x-1.5" title="Equipe">
                {p.equipe.slice(0, 5).map((u) => (
                  <Avatar key={u} name={profiles.get(u)?.full_name} size={24} className="ring-2 ring-surface" />
                ))}
              </span>
            )}
          </div>
          {canWrite ? (
            <QuickStatus id={id} fase={p.fase} status={p.status} action={setProcessoFaseStatus} />
          ) : (
            <div className="flex gap-2">
              <StatusBadge options={PROCESSO_FASES} value={p.fase} />
              <StatusBadge options={PROCESSO_STATUS} value={p.status} />
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5">
          {[
            { label: "Valor da causa", value: p.valor_causa != null ? brl(p.valor_causa) : "—", icon: Landmark },
            { label: "Risco / provisão", value: p.risco ? `${optionLabel(PROCESSO_RISCO, p.risco)}${p.valor_provisionado ? ` · ${brl(p.valor_provisionado)}` : ""}` : "Não avaliado", icon: Scale },
            {
              label: "Próximo prazo",
              value: proxPrazo ? `${date(proxPrazo.data_fim)}${prazoDias !== null ? (prazoDias < 0 ? ` · vencido há ${-prazoDias}d` : prazoDias === 0 ? " · HOJE" : ` · em ${prazoDias}d`) : ""}` : "Nenhum pendente",
              icon: AlarmClock,
              alert: prazoDias !== null && prazoDias <= 1,
            },
            { label: "Próxima audiência", value: proxAud ? dateTime(proxAud.data_hora) : "Nenhuma agendada", icon: Gavel },
            { label: "Distribuição", value: p.data_distribuicao ? `${date(p.data_distribuicao)}${p.data_encerramento ? ` → ${date(p.data_encerramento)}` : ""}` : "—", icon: CalendarClock },
          ].map((k) => (
            <div key={k.label} className="flex items-center gap-3 border-b border-line px-6 py-4 lg:border-b-0 lg:[&:not(:last-child)]:border-r">
              <k.icon className={`h-5 w-5 shrink-0 ${"alert" in k && k.alert ? "text-red-500" : "text-accent-500"}`} />
              <div className="min-w-0">
                <p className="text-xs text-muted">{k.label}</p>
                <p className={`truncate text-sm font-semibold ${"alert" in k && k.alert ? "text-red-600 dark:text-red-400" : ""}`}>{k.value}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <LinkTabs
        base={`/processos/${id}`}
        active={tab}
        tabs={[
          { key: "andamentos", label: "Andamentos", count: ands.length },
          { key: "prazos", label: "Prazos", count: prazosPend ?? 0 },
          { key: "audiencias", label: "Audiências", count: audCount ?? 0 },
          { key: "partes", label: "Partes", count: pts.length },
          { key: "financeiro", label: "Custas e honorários", count: lcs.length },
          { key: "tarefas", label: "Tarefas", count: tfs.length },
          { key: "documentos", label: "Documentos", count: docCount ?? 0 },
          { key: "dados", label: "Dados do processo" },
        ]}
      />

      {tab === "andamentos" && (
        <DatajudPanel
          processoId={id}
          temCnj={!!p.numero_cnj}
          consultavel={podeConsultarDatajud(p.numero_cnj)}
          status={p.datajud_status ?? null}
          erro={p.datajud_erro ?? null}
          sincronizadoEm={p.datajud_sincronizado_em ?? null}
          atualizadoEm={p.datajud_atualizado_em ?? null}
          monitorar={p.datajud_monitorar ?? true}
          podeEditar={canWrite}
          importados={ands.filter((a) => a.origem === "datajud").length}
          actions={{ sincronizar: sincronizarDatajud, monitorar: alternarMonitoramentoDatajud }}
        />
      )}

      {tab === "andamentos" && (
        <Card>
          <CardHeader
            title="Linha do tempo processual"
            description="Publicações, decisões, petições e registros automáticos (prazos, audiências, mudanças de fase)"
            icon={<FileText className="h-4 w-4" />}
            action={
              canWrite && (
                <FormDrawerButton action={addAndamento} hidden={{ processo_id: id }} fields={andamentoFields} values={{ data: hoje, tipo: "publicacao" }} title="Registrar andamento" label="Novo andamento" size="sm" width="max-w-xl" />
              )
            }
          />
          <CardBody>
            {ands.length === 0 ? (
              <EmptyState title="Nenhum andamento registrado" description="Registre publicações, despachos e decisões para manter o histórico do caso." />
            ) : (
              <ol className="relative space-y-5 border-l-2 border-line pl-6">
                {ands.map((a) => {
                  const tipo = ANDAMENTO_TIPOS.find((t) => t.value === a.tipo);
                  return (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[31px] top-1 h-4 w-4 rounded-full bg-brand-500 ring-4 ring-surface" />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                            <b className="text-sm font-semibold text-fg">{date(a.data)}</b>
                            <Badge tone={tipo?.tone ?? "slate"}>{tipo?.label ?? a.tipo}</Badge>
                            {a.origem === "datajud" && <Badge tone="sky">DataJud</Badge>}
                            {a.autor_id && <span>{profiles.get(a.autor_id)?.full_name}</span>}
                            <span title={dateTime(a.created_at)}>· {relative(a.created_at)}</span>
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{a.descricao}</p>
                        </div>
                        {canWrite && (a.autor_id === profile.id || can(profile.role, "processos.delete")) && <ConfirmAction action={deleteAndamento} id={a.id} title="Remover andamento?" />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "prazos" && (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}>
          <PrazosPanel processoId={id} />
        </Suspense>
      )}

      {tab === "audiencias" && (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}>
          <AudienciasPanel processoId={id} />
        </Suspense>
      )}

      {tab === "partes" && (
        <Card>
          <CardHeader
            title="Partes e envolvidos"
            icon={<Users className="h-4 w-4" />}
            action={canWrite && <FormDrawerButton action={saveParte} hidden={{ processo_id: id }} fields={parteFields} values={{ tipo: p.polo_cliente === "ativo" ? "reu" : "autor" }} title="Adicionar parte" label="Adicionar" size="sm" width="max-w-xl" />}
          />
          {pts.length === 0 ? (
            <EmptyState title="Nenhuma parte cadastrada" description="Inclua autores, réus, advogados da parte contrária, peritos e testemunhas." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Tipo</th>
                    <th>Documento / OAB</th>
                    <th>Contato</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pts.map((pt) => (
                    <tr key={pt.id}>
                      <td className="font-medium">{pt.nome}</td>
                      <td><Badge tone="brand">{optionLabel(PARTE_TIPOS, pt.tipo)}</Badge></td>
                      <td className="text-sm">{[pt.documento && maskDocumento(pt.documento), pt.oab && `OAB ${pt.oab}`].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-sm">{pt.contato ?? "—"}</td>
                      <td>
                        {canWrite && (
                          <div className="flex justify-end gap-1">
                            <FormDrawerButton action={saveParte} hidden={{ processo_id: id, id: pt.id }} fields={parteFields} values={{ ...pt }} title="Editar parte" icon="edit" size="icon" variant="ghost" width="max-w-xl" />
                            <ConfirmAction action={deleteParte} id={pt.id} title="Remover parte?" />
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
      )}

      {tab === "financeiro" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5"><p className="text-xs text-muted">Honorários e acordos (entradas)</p><p className="mt-1 text-xl font-bold text-emerald-600">{brl(entradas)}</p></Card>
            <Card className="p-5"><p className="text-xs text-muted">Custas, despesas e depósitos (saídas)</p><p className="mt-1 text-xl font-bold text-red-600">{brl(saidas)}</p></Card>
            <Card className="p-5"><p className="text-xs text-muted">Resultado do caso</p><p className="mt-1 text-xl font-bold">{brl(entradas - saidas)}</p></Card>
          </div>
          <Card>
            <CardHeader
              title="Lançamentos do processo"
              icon={<Wallet className="h-4 w-4" />}
              action={canFin && <FormDrawerButton action={saveLancamento} hidden={{ processo_id: id }} fields={lancamentoFields} values={{ tipo: "custas", status: "previsto", data: hoje }} title="Novo lançamento" label="Lançar" size="sm" width="max-w-xl" />}
            />
            {lcs.length === 0 ? (
              <EmptyState title="Nenhum lançamento" description="Registre custas, despesas, depósitos judiciais e honorários do caso." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th>Descrição</th>
                      <th>Vencimento</th>
                      <th className="text-right">Valor</th>
                      <th>Situação</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {lcs.map((l) => (
                      <tr key={l.id}>
                        <td className="text-sm">{date(l.data)}</td>
                        <td className="text-sm">{optionLabel(LANCAMENTO_TIPOS, l.tipo)}</td>
                        <td className="text-sm">{l.descricao ?? "—"}</td>
                        <td className="text-sm">{date(l.vencimento)}</td>
                        <td className={`text-right font-semibold tabular-nums ${ENTRADAS.has(l.tipo) ? "text-emerald-600" : ""}`}>{brl(l.valor)}</td>
                        <td><StatusBadge options={LANCAMENTO_STATUS} value={l.status} /></td>
                        <td>
                          {canFin && (
                            <div className="flex justify-end gap-1">
                              <FormDrawerButton action={saveLancamento} hidden={{ processo_id: id, id: l.id }} fields={lancamentoFields} values={{ ...l }} title="Editar lançamento" icon="edit" size="icon" variant="ghost" width="max-w-xl" />
                              <ConfirmAction action={deleteLancamento} id={l.id} title="Remover lançamento?" />
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
        </div>
      )}

      {tab === "tarefas" && (
        <Card>
          <CardHeader
            title="Tarefas do processo"
            icon={<ListChecks className="h-4 w-4" />}
            action={
              <LinkButton href={`/tarefas?novo=1&processo_id=${id}${p.cliente_id ? `&cliente_id=${p.cliente_id}` : ""}${p.departamento_id ? `&departamento_id=${p.departamento_id}` : ""}`} size="sm" variant="secondary">
                <Plus className="h-4 w-4" /> Nova tarefa
              </LinkButton>
            }
          />
          {tfs.length === 0 ? (
            <EmptyState title="Nenhuma tarefa vinculada" description="Distribua peças, diligências e conferências para a equipe." />
          ) : (
            <ul className="divide-y divide-line">
              {tfs.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t.titulo}</p>
                    <p className="text-xs text-muted">
                      {t.responsavel_id ? profiles.get(t.responsavel_id)?.full_name : "Sem responsável"} · vence {date(t.vencimento)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <StatusBadge options={PRIORIDADES} value={t.prioridade} />
                    <StatusBadge options={TAREFA_STATUS} value={t.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "documentos" && (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}>
          <DocumentosPanel processoId={id} podeEnviar={canWrite} />
        </Suspense>
      )}

      {tab === "dados" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Identificação e juízo" icon={<Gavel className="h-4 w-4" />} />
            <CardBody className="space-y-3 text-sm">
              {[
                ["Número CNJ", p.numero_cnj],
                ["Segmento / tribunal (pelo CNJ)", cnjInfo ? `${cnjInfo.segmento}${cnjInfo.tribunal ? ` · ${cnjInfo.tribunal}` : ""}` : null],
                ["Área", optionLabel(PROCESSO_AREAS, p.area)],
                ["Classe", p.classe],
                ["Assunto", p.assunto],
                ["Tribunal", p.tribunal],
                ["Vara / órgão", p.orgao],
                ["Comarca / UF", [p.comarca, p.uf].filter(Boolean).join(" / ")],
                ["Instância", optionLabel(INSTANCIAS, String(p.instancia))],
              ].map(([l, v]) => (
                <div key={l as string} className="flex justify-between gap-4 border-b border-line pb-2.5 last:border-0">
                  <span className="text-muted">{l}</span>
                  <span className="text-right font-medium">{(v as string) || "—"}</span>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Gestão do caso" icon={<Building2 className="h-4 w-4" />} />
            <CardBody className="space-y-3 text-sm">
              {[
                ["Departamento", dep ? <Badge key="d" tone={(dep.cor as Tone) ?? "brand"}>{dep.nome}</Badge> : null],
                ["Responsável", resp?.full_name],
                ["Equipe", p.equipe.map((u) => profiles.get(u)?.full_name).filter(Boolean).join(", ")],
                ["Situação", optionLabel(PROCESSO_STATUS, p.status)],
                ["Fase", optionLabel(PROCESSO_FASES, p.fase)],
                ["Resultado", p.resultado],
                ["Cadastrado em", dateTime(p.created_at)],
              ].map(([l, v]) => (
                <div key={l as string} className="flex justify-between gap-4 border-b border-line pb-2.5 last:border-0">
                  <span className="text-muted">{l as string}</span>
                  <span className="text-right font-medium">{(v as React.ReactNode) || "—"}</span>
                </div>
              ))}
              {p.observacoes && (
                <div className="rounded-xl bg-surface-2 p-3">
                  <p className="mb-1 text-xs font-semibold text-muted">Observações e estratégia</p>
                  <p className="whitespace-pre-wrap">{p.observacoes}</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
