import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Mail, MapPin, MessageCircle, Phone, Landmark, ShieldCheck, KanbanSquare, CalendarDays, ListChecks, Plus, Briefcase, Cake, Wallet, Scale, FileJson, FolderOpen } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { consultorOptions, getProfileMap } from "@/lib/data";
import { PROCESSO_AREAS, PROCESSO_FASES, PROCESSO_STATUS, APOLICE_STATUS, CLIENTE_STATUS, COTA_STATUS, ETAPAS, EVENTO_TIPOS, INTERACAO_TIPOS, ORIGENS, RAMOS_SEGURO, CATEGORIAS_CONSORCIO, TAREFA_STATUS, PRIORIDADES } from "@/lib/constants";
import { brl, date, dateTime, maskDocumento, maskPhone, relative, whatsappLink } from "@/lib/format";
import type { AgendaEvento, Cliente, ConsorcioCota, Interacao, Oportunidade, SeguroApolice, Tarefa } from "@/lib/types";
import { addInteracao, deleteCliente, deleteInteracao, updateCliente } from "@/lib/actions/clientes";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DrivePastaButton } from "@/components/documentos/drive-pasta-button";
import { getDriveEscritorioStatus } from "@/components/documentos/google-status";
import { anonimizarCliente } from "@/lib/actions/lgpd";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { LinkTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentosPanel } from "@/components/documentos/documentos-panel";
import { clienteFields } from "../fields";

export const metadata: Metadata = { title: "Cliente" };

export default async function ClientePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { profile } = await requirePermission("clientes.view");
  const { id } = await params;
  const { tab = "geral" } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: cliente } = await supabase.from("clientes").select("*").eq("id", id).maybeSingle<Cliente>();
  if (!cliente) notFound();

  const [{ data: interacoes }, { data: oportunidades }, { data: cotas }, { data: apolices }, { data: eventos }, { data: tarefas }, { count: docCount }] = await Promise.all([
    supabase.from("interacoes").select("*").eq("cliente_id", id).order("created_at", { ascending: false }).limit(100),
    supabase.from("oportunidades").select("*").eq("cliente_id", id).order("created_at", { ascending: false }),
    supabase.from("consorcio_cotas").select("*").eq("cliente_id", id).order("created_at", { ascending: false }),
    supabase.from("seguro_apolices").select("*").eq("cliente_id", id).order("fim_vigencia", { ascending: false }),
    supabase.from("agenda_eventos").select("*").eq("cliente_id", id).order("inicio", { ascending: false }).limit(50),
    supabase.from("tarefas").select("*").eq("cliente_id", id).order("vencimento", { ascending: true }).limit(50),
    supabase.from("documentos").select("id", { count: "exact", head: true }).eq("cliente_id", id),
  ]);
  const canProcessos = can(profile.role, "processos.view");
  const { data: processosData } = canProcessos
    ? await supabase.from("processos").select("id, titulo, numero_cnj, area, fase, status, parte_contraria, updated_at").eq("cliente_id", id).order("updated_at", { ascending: false })
    : { data: [] };
  const procs = processosData ?? [];
  const [profiles, consultores, drive] = await Promise.all([getProfileMap(), consultorOptions(), getDriveEscritorioStatus()]);
  const consultor = cliente.consultor_id ? profiles.get(cliente.consultor_id) : null;
  const canWrite = can(profile.role, "clientes.write");
  const canTransfer = can(profile.role, "clientes.transfer");
  const ops = (oportunidades ?? []) as Oportunidade[];
  const cts = (cotas ?? []) as ConsorcioCota[];
  const aps = (apolices ?? []) as SeguroApolice[];
  const evs = (eventos ?? []) as AgendaEvento[];
  const tfs = (tarefas ?? []) as Tarefa[];
  const hist = (interacoes ?? []) as Interacao[];
  const wa = whatsappLink(cliente.whatsapp || cliente.telefone, `Olá ${cliente.nome.split(" ")[0]}, tudo bem? Aqui é da EASY Consórcio & Seguros.`);

  const totalCredito = cts.filter((c) => c.status !== "cancelada").reduce((a, c) => a + Number(c.valor_credito), 0);
  const totalPremio = aps.filter((a) => a.status === "vigente").reduce((a, c) => a + Number(c.premio_total), 0);

  return (
    <>
      <Link href="/clientes" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Clientes</Link>

      <Card className="mb-6 overflow-hidden">
        <div className="brand-gradient h-20" />
        <div className="-mt-10 flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:items-end">
          <Avatar name={cliente.nome} size={84} className="ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{cliente.nome}</h1>
              <StatusBadge options={CLIENTE_STATUS} value={cliente.status} />
              {cliente.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {cliente.documento && <span>{maskDocumento(cliente.documento)}</span>}
              {cliente.cidade && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{cliente.cidade}/{cliente.uf}</span>}
              <span>Consultor: <b className="font-medium text-fg">{consultor?.full_name ?? "—"}</b></span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
            {cliente.telefone && <a href={`tel:${cliente.telefone}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2" aria-label="Ligar"><Phone className="h-4 w-4" /></a>}
            {cliente.email && <a href={`mailto:${cliente.email}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2" aria-label="E-mail"><Mail className="h-4 w-4" /></a>}
            {canWrite && <FormDrawerButton action={updateCliente} fields={clienteFields(consultores, canTransfer)} values={{ ...cliente, tags: cliente.tags.join(", ") }} hidden={{ id }} title="Editar cliente" label="Editar" icon="edit" variant="secondary" />}
            {drive.ativo && <DrivePastaButton tipo="cliente" id={id} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold text-fg hover:bg-surface-2 hover:no-underline dark:text-fg" />}
            {can(profile.role, "lgpd.exportar") && (
              <a href={`/api/lgpd/cliente/${id}`} download className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2" title="Relatório de dados pessoais do titular (LGPD, art. 18)">
                <FileJson className="h-4 w-4" /> Dados LGPD
              </a>
            )}
            {can(profile.role, "lgpd.anonimizar") && (
              <ConfirmAction
                action={anonimizarCliente}
                id={id}
                title="Anonimizar dados pessoais do titular?"
                message="Irreversível. Nome, CPF/CNPJ, contatos, endereço e observações serão apagados; atendimentos e anotações terão o conteúdo removido; arquivos do armazenamento serão excluídos. Bloqueado se houver processo ativo ou contrato vigente. Use apenas para atender pedido do titular sem dever legal de guarda."
                confirmLabel="Anonimizar"
                label="Anonimizar (LGPD)"
                variant="secondary"
              />
            )}
            {can(profile.role, "clientes.delete") && <ConfirmAction action={deleteCliente} id={id} title="Excluir cliente?" message="O cliente e seu histórico serão removidos. Clientes com consórcios ou seguros não podem ser excluídos." redirectTo="/clientes" variant="secondary" />}
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-line sm:grid-cols-4">
          {[
            ...(canProcessos ? [{ label: "Processos ativos", value: procs.filter((pr) => pr.status === "ativo" || pr.status === "suspenso").length, icon: Scale }] : []),
            { label: "Documentos", value: docCount ?? 0, icon: FolderOpen },
            ...(totalCredito || totalPremio ? [{ label: "Consórcio / seguros", value: brl(totalCredito + totalPremio), icon: Landmark }] : [{ label: "Oportunidades abertas", value: ops.filter((o) => !["ganho", "perdido"].includes(o.etapa)).length, icon: KanbanSquare }]),
            { label: "Cliente desde", value: date(cliente.created_at), icon: CalendarDays },
          ].map((k) => (
            <div key={k.label} className="flex items-center gap-3 border-line px-6 py-4 [&:not(:last-child)]:border-r">
              <k.icon className="h-5 w-5 text-accent-500" />
              <div><p className="text-xs text-muted">{k.label}</p><p className="font-semibold">{k.value}</p></div>
            </div>
          ))}
        </div>
      </Card>

      <LinkTabs
        base={`/clientes/${id}`}
        active={tab}
        tabs={[
          { key: "geral", label: "Visão geral" },
          ...(canProcessos ? [{ key: "processos", label: "Processos", count: procs.length }] : []),
          { key: "negocios", label: "Negócios", count: ops.length + cts.length + aps.length },
          { key: "agenda", label: "Agenda e tarefas", count: evs.length + tfs.length },
          { key: "documentos", label: "Documentos", count: docCount ?? 0 },
        ]}
      />

      {tab === "geral" && (
        <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
          <Card>
            <CardHeader title="Dados cadastrais" />
            <CardBody className="space-y-4 text-sm">
              {[
                ["Tipo", cliente.tipo_pessoa === "PF" ? "Pessoa física" : "Pessoa jurídica"],
                ["RG / IE", cliente.rg],
                ["Nascimento", cliente.data_nascimento ? date(cliente.data_nascimento) : null, Cake],
                ["E-mail", cliente.email, Mail],
                ["Telefone", maskPhone(cliente.telefone), Phone],
                ["WhatsApp", maskPhone(cliente.whatsapp), MessageCircle],
                ["Endereço", [cliente.endereco, cliente.numero, cliente.complemento, cliente.bairro].filter(Boolean).join(", ") + (cliente.cep ? ` · CEP ${cliente.cep}` : ""), MapPin],
                ["Profissão", cliente.profissao, Briefcase],
                ["Renda / faturamento", cliente.renda_mensal ? brl(cliente.renda_mensal) : null, Wallet],
                ["Origem", optionLabel(ORIGENS, cliente.origem)],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                  <span className="text-muted">{label as string}</span>
                  <span className="text-right font-medium">{(value as string) || "—"}</span>
                </div>
              ))}
              {cliente.observacoes && <div className="rounded-xl bg-surface-2 p-3 text-sm"><p className="mb-1 text-xs font-semibold text-muted">Observações</p><p className="whitespace-pre-wrap">{cliente.observacoes}</p></div>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Linha do tempo"
              description="Contatos, anotações e eventos automáticos do sistema"
              action={<FormDrawerButton action={addInteracao} hidden={{ cliente_id: id }} fields={[{ name: "tipo", label: "Tipo de registro", type: "select", options: INTERACAO_TIPOS, emptyOption: false, required: true }, { name: "descricao", label: "Descrição", type: "textarea", rows: 6, required: true, placeholder: "O que foi conversado, próximos passos…" }]} values={{ tipo: "nota" }} title="Registrar contato" label="Registrar" size="sm" width="max-w-lg" />}
            />
            <CardBody>
              {hist.length === 0 ? (
                <EmptyState title="Sem registros ainda" description="Registre ligações, visitas e anotações para manter o histórico do cliente." />
              ) : (
                <ol className="relative space-y-5 border-l-2 border-line pl-6">
                  {hist.map((h) => (
                    <li key={h.id} className="relative">
                      <span className={`absolute -left-[31px] top-1 grid h-4 w-4 place-items-center rounded-full ring-4 ring-surface ${h.tipo === "sistema" ? "bg-brand-400" : "bg-accent-500"}`} />
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                            <Badge tone={h.tipo === "sistema" ? "brand" : "accent"}>{h.tipo === "sistema" ? "Sistema" : optionLabel(INTERACAO_TIPOS, h.tipo)}</Badge>
                            <span>{h.autor_id ? profiles.get(h.autor_id)?.full_name : ""}</span>
                            <span title={dateTime(h.created_at)}>· {relative(h.created_at)}</span>
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm">{h.descricao}</p>
                        </div>
                        {h.tipo !== "sistema" && (h.autor_id === profile.id || can(profile.role, "clientes.delete")) && <ConfirmAction action={deleteInteracao} id={h.id} title="Remover registro?" />}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "processos" && canProcessos && (
        <Card>
          <CardHeader
            title="Processos do cliente"
            icon={<Scale className="h-4 w-4" />}
            action={can(profile.role, "processos.write") && <LinkButton href={`/processos?novo=1&cliente_id=${id}`} size="sm" variant="secondary"><Plus className="h-4 w-4" />Novo processo</LinkButton>}
          />
          {procs.length === 0 ? <EmptyState title="Nenhum processo vinculado" /> : (
            <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Processo</th><th>Área</th><th>Fase</th><th>Situação</th><th>Atualizado</th></tr></thead><tbody>
              {procs.map((pr) => <tr key={pr.id}><td><Link href={`/processos/${pr.id}`} className="font-medium hover:text-brand-600">{pr.titulo}</Link><div className="font-mono text-xs text-muted">{pr.numero_cnj ?? "sem número"}{pr.parte_contraria ? ` · × ${pr.parte_contraria}` : ""}</div></td><td className="text-sm">{optionLabel(PROCESSO_AREAS, pr.area)}</td><td><StatusBadge options={PROCESSO_FASES} value={pr.fase} /></td><td><StatusBadge options={PROCESSO_STATUS} value={pr.status} /></td><td className="text-xs text-muted">{date(pr.updated_at)}</td></tr>)}
            </tbody></table></div>
          )}
        </Card>
      )}

      {tab === "negocios" && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Oportunidades" icon={<KanbanSquare className="h-4 w-4" />} action={canWrite && <LinkButton href={`/oportunidades?novo=1&cliente_id=${id}`} size="sm" variant="secondary"><Plus className="h-4 w-4" />Nova</LinkButton>} />
            {ops.length === 0 ? <EmptyState title="Nenhuma oportunidade" /> : (
              <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Título</th><th>Linha</th><th>Etapa</th><th>Valor</th><th>Previsão</th></tr></thead><tbody>
                {ops.map((o) => <tr key={o.id}><td className="font-medium"><Link href={`/oportunidades?abrir=${o.id}`}>{o.titulo}</Link></td><td>{o.linha === "consorcio" ? "Consórcio" : "Seguro"}</td><td><StatusBadge options={ETAPAS} value={o.etapa} /></td><td>{brl(o.valor)}</td><td>{date(o.previsao_fechamento)}</td></tr>)}
              </tbody></table></div>
            )}
          </Card>
          <Card>
            <CardHeader title="Consórcios" icon={<Landmark className="h-4 w-4" />} action={canWrite && <LinkButton href={`/consorcios?novo=1&cliente_id=${id}`} size="sm" variant="secondary"><Plus className="h-4 w-4" />Nova cota</LinkButton>} />
            {cts.length === 0 ? <EmptyState title="Nenhuma cota de consórcio" /> : (
              <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Grupo / cota</th><th>Categoria</th><th>Crédito</th><th>Parcela</th><th>Status</th></tr></thead><tbody>
                {cts.map((c) => <tr key={c.id}><td className="font-medium"><Link href={`/consorcios/${c.id}`} className="hover:text-brand-600">{c.grupo ?? "—"} / {c.cota ?? "—"}</Link></td><td>{optionLabel(CATEGORIAS_CONSORCIO, c.categoria)}</td><td>{brl(c.valor_credito)}</td><td>{brl(c.parcela_valor)}</td><td><StatusBadge options={COTA_STATUS} value={c.status} /></td></tr>)}
              </tbody></table></div>
            )}
          </Card>
          <Card>
            <CardHeader title="Seguros" icon={<ShieldCheck className="h-4 w-4" />} action={canWrite && <LinkButton href={`/seguros?novo=1&cliente_id=${id}`} size="sm" variant="secondary"><Plus className="h-4 w-4" />Novo seguro</LinkButton>} />
            {aps.length === 0 ? <EmptyState title="Nenhum seguro" /> : (
              <div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Apólice</th><th>Ramo</th><th>Vigência</th><th>Prêmio</th><th>Status</th></tr></thead><tbody>
                {aps.map((a) => <tr key={a.id}><td className="font-medium"><Link href={`/seguros/${a.id}`} className="hover:text-brand-600">{a.numero_apolice ?? a.numero_proposta ?? "s/n"}</Link><div className="text-xs text-muted">{a.item_segurado}</div></td><td>{optionLabel(RAMOS_SEGURO, a.ramo)}</td><td className="text-xs">{date(a.inicio_vigencia)} → {date(a.fim_vigencia)}</td><td>{brl(a.premio_total)}</td><td><StatusBadge options={APOLICE_STATUS} value={a.status} /></td></tr>)}
              </tbody></table></div>
            )}
          </Card>
        </div>
      )}

      {tab === "agenda" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Compromissos" icon={<CalendarDays className="h-4 w-4" />} action={<LinkButton href={`/agenda?novo=1&cliente_id=${id}`} size="sm" variant="secondary"><Plus className="h-4 w-4" />Agendar</LinkButton>} />
            {evs.length === 0 ? <EmptyState title="Nenhum compromisso" /> : (
              <ul className="divide-y divide-line">{evs.map((e) => <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium">{e.titulo}</p><p className="text-xs text-muted">{dateTime(e.inicio)}{e.local ? ` · ${e.local}` : ""}</p></div><StatusBadge options={EVENTO_TIPOS} value={e.tipo} /></li>)}</ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Tarefas" icon={<ListChecks className="h-4 w-4" />} action={<LinkButton href={`/tarefas?novo=1&cliente_id=${id}`} size="sm" variant="secondary"><Plus className="h-4 w-4" />Nova tarefa</LinkButton>} />
            {tfs.length === 0 ? <EmptyState title="Nenhuma tarefa" /> : (
              <ul className="divide-y divide-line">{tfs.map((t) => <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium">{t.titulo}</p><p className="text-xs text-muted">Vence {date(t.vencimento)}</p></div><div className="flex gap-1.5"><StatusBadge options={PRIORIDADES} value={t.prioridade} /><StatusBadge options={TAREFA_STATUS} value={t.status} /></div></li>)}</ul>
            )}
          </Card>
        </div>
      )}

      {tab === "documentos" && (
        <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-surface-2" />}>
          <DocumentosPanel clienteId={id} />
        </Suspense>
      )}
    </>
  );
}
