import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Filter, Link2, Share2, SlidersHorizontal, UserPlus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { departamentoOptions, getProfileMap, pageRange, searchTerm, userOptions } from "@/lib/data";
import { DISTRIBUICAO_CRITERIOS, LEAD_ORIGENS, LEAD_STATUS, toMap } from "@/lib/constants";
import { dateTime, maskPhone, todayISO } from "@/lib/format";
import { env } from "@/lib/env";
import { atribuirLead, atualizarLead, converterLead, novoLead, salvarFormulario, salvarPaginaMeta, salvarParametrosLeads, salvarRegra } from "@/lib/actions/leads";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { LinkTabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { RealtimeRefresh } from "@/components/ui/realtime-refresh";
import { SettingsForm } from "@/components/configuracoes/settings-form";

export const metadata: Metadata = { title: "Leads" };

type Lead = {
  id: string; nome: string; telefone: string | null; email: string | null; cidade: string | null; origem: string; campanha: string | null; interesse: string | null;
  score: number; status: string; responsavel_id: string | null; sla_ate: string | null; sla_estourado: boolean; primeiro_contato_em: string | null;
  cliente_id: string | null; observacoes: string | null; motivo_descarte: string | null; created_at: string;
};
const origens = toMap(LEAD_ORIGENS);

/** Leads de todas as fontes: lista com SLA, funil por origem/campanha/responsável, regras de distribuição e captação. */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireSession();
  if (!can(profile, "leads.view")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const distribui = can(profile, "leads.distribuir");
  const tabs = [
    { key: "lista", label: "Leads" },
    { key: "funil", label: "Funil e origem" },
    ...(distribui ? [{ key: "regras", label: "Distribuição" }, { key: "captacao", label: "Formulários e Lead Ads" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "lista";
  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Leads"
        description="Contatos de WhatsApp, site, Facebook/Instagram e indicações: deduplicados, pontuados e distribuídos automaticamente, com prazo para o primeiro contato."
        actions={can(profile, "leads.write") && (
          <FormDrawerButton action={novoLead} title="Novo lead" label="Novo lead" variant="accent" values={{ origem: "consultor" }}
            fields={[
              { name: "nome", label: "Nome", required: true, span: 6 },
              { name: "telefone", label: "WhatsApp / telefone", type: "tel", span: 3 },
              { name: "email", label: "E-mail", type: "email", span: 3 },
              { name: "documento", label: "CPF/CNPJ", type: "documento", span: 3 },
              { name: "origem", label: "Origem", type: "select", options: LEAD_ORIGENS, required: true, span: 3 },
              { name: "cidade", label: "Cidade", span: 4 },
              { name: "uf", label: "UF", span: 2 },
              { name: "interesse", label: "Interesse", span: 3 },
              { name: "renda", label: "Renda informada", type: "money", span: 3 },
              { name: "campanha", label: "Campanha", span: 6 },
              { name: "mensagem", label: "Observações", type: "textarea", rows: 3, span: 6 },
            ]} />
        )}
      />
      <LinkTabs base="/leads" tabs={tabs} active={tab} />
      {tab === "lista" && <Lista sp={sp} userId={userId} distribui={distribui} podeEditar={can(profile, "leads.write")} />}
      {tab === "funil" && <Funil sp={sp} />}
      {tab === "regras" && distribui && <Regras />}
      {tab === "captacao" && distribui && <Captacao />}
    </>
  );
}

async function Lista({ sp, userId, distribui, podeEditar }: { sp: Record<string, string | undefined>; userId: string; distribui: boolean; podeEditar: boolean }) {
  const { page, size, from, to } = pageRange(sp.page, 25);
  const supabase = await createClient();
  let q = supabase.from("leads").select("*", { count: "estimated" }).order("created_at", { ascending: false }).range(from, to);
  if (sp.status && LEAD_STATUS.some((s) => s.value === sp.status)) q = q.eq("status", sp.status);
  else if (!sp.status) q = q.in("status", ["novo", "em_contato", "qualificado"]);
  if (sp.origem && origens[sp.origem]) q = q.eq("origem", sp.origem);
  if (sp.resp === "meus") q = q.eq("responsavel_id", userId);
  else if (sp.resp === "sem") q = q.is("responsavel_id", null);
  if (sp.sla === "estourado") q = q.eq("sla_estourado", true);
  const termo = searchTerm(sp.q);
  if (termo) q = q.or(`nome.ilike.%${termo}%,telefone.ilike.%${termo.replace(/\D/g, "") || "_"}%,campanha.ilike.%${termo}%`);
  const [{ data, count }, profiles, usuarios] = await Promise.all([q, getProfileMap(), distribui ? userOptions() : Promise.resolve([])]);
  const leads = (data ?? []) as Lead[];
  const agora = Date.now();
  return (
    <Card>
      <RealtimeRefresh tabelas={["leads"]} />
      <CardHeader title="Leads" icon={<UserPlus className="h-4 w-4" />} />
      <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row">
        <Suspense>
          <SearchInput placeholder="Nome, telefone ou campanha" />
          <FilterSelect param="status" options={LEAD_STATUS} allLabel="Em aberto" />
          <FilterSelect param="origem" options={LEAD_ORIGENS} allLabel="Todas as origens" />
          <FilterSelect param="resp" options={[{ value: "meus", label: "Meus leads" }, ...(distribui ? [{ value: "sem", label: "Sem responsável" }] : [])]} allLabel="Todos os responsáveis" />
          <FilterSelect param="sla" options={[{ value: "estourado", label: "SLA estourado" }]} allLabel="Qualquer SLA" />
        </Suspense>
      </div>
      {leads.length === 0 ? <EmptyState icon={<UserPlus className="h-6 w-6" />} title="Nenhum lead" description="Leads do WhatsApp, do formulário público e do Facebook/Instagram aparecem aqui automaticamente." /> : (
        <div className="overflow-x-auto"><table className="table-base">
          <thead><tr><th>Lead</th><th>Origem</th><th className="text-right">Score</th><th>Responsável</th><th>Primeiro contato</th><th>Etapa</th><th /></tr></thead>
          <tbody>
            {leads.map((l) => {
              const atrasado = l.status === "novo" && !l.primeiro_contato_em && l.sla_ate && new Date(l.sla_ate).getTime() < agora;
              return (
                <tr key={l.id}>
                  <td>
                    <p className="font-medium">{l.nome}</p>
                    <p className="text-xs text-muted">{[l.telefone ? maskPhone(l.telefone.slice(2)) : null, l.cidade, l.interesse].filter(Boolean).join(" · ") || "—"}</p>
                  </td>
                  <td className="text-sm">{origens[l.origem]?.label ?? l.origem}{l.campanha && <p className="text-xs text-muted">{l.campanha}</p>}</td>
                  <td className="text-right text-sm font-semibold">{l.score}</td>
                  <td className="text-sm">{l.responsavel_id ? profiles.get(l.responsavel_id)?.full_name ?? "—" : <span className="text-amber-600">Fila geral</span>}</td>
                  <td className="whitespace-nowrap text-xs">
                    {l.primeiro_contato_em ? dateTime(l.primeiro_contato_em) : l.sla_ate ? <span className={atrasado ? "font-semibold text-red-600" : "text-muted"}>{atrasado ? "Atrasado desde " : "Até "}{dateTime(l.sla_ate)}</span> : "—"}
                    {l.sla_estourado && <p className="text-[11px] text-red-600">SLA estourado</p>}
                  </td>
                  <td><StatusBadge options={LEAD_STATUS} value={l.status} /></td>
                  <td className="whitespace-nowrap text-right">
                    <div className="flex justify-end gap-1">
                      {podeEditar && l.status !== "convertido" && (
                        <FormDrawerButton action={atualizarLead} title={l.nome} label="Etapa" icon="edit" variant="ghost" size="sm" hidden={{ id: l.id }}
                          values={{ status: l.status, interesse: l.interesse, observacoes: l.observacoes, motivo_descarte: l.motivo_descarte }}
                          fields={[
                            { name: "status", label: "Etapa", type: "select", options: LEAD_STATUS.filter((s) => s.value !== "convertido"), required: true, span: 6 },
                            { name: "interesse", label: "Interesse", span: 6 },
                            { name: "observacoes", label: "Observações", type: "textarea", rows: 4, span: 6 },
                            { name: "motivo_descarte", label: "Motivo do descarte (se descartar)", span: 6 },
                          ]} />
                      )}
                      {distribui && l.status !== "convertido" && (
                        <FormDrawerButton action={atribuirLead} title="Redistribuir lead" label="Atribuir" icon="none" variant="ghost" size="sm" hidden={{ id: l.id }} values={{ responsavel_id: l.responsavel_id }}
                          fields={[{ name: "responsavel_id", label: "Responsável", type: "select", options: usuarios, required: true, span: 6 }]} />
                      )}
                      {podeEditar && ["novo", "em_contato", "qualificado"].includes(l.status) && <ActionButton action={converterLead.bind(null, l.id)} label="Converter" variant="outline" />}
                      {l.cliente_id && <a href={`/clientes/${l.cliente_id}`} className="px-2 text-xs font-semibold text-brand-600">Cliente</a>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      <Pagination page={page} pageSize={size} total={count ?? 0} />
    </Card>
  );
}

type Relatorio = {
  por_origem: { origem: string; campanha: string; total: number; convertidos: number; descartados: number; score_medio: number }[];
  por_responsavel: { responsavel_id: string | null; total: number; convertidos: number; sla_estourado: number; min_ate_contato: number | null }[];
  tempo_medio: { ate_contato_min: number | null; ate_conversao_h: number | null };
  descartes: { motivo: string; total: number }[];
};

async function Funil({ sp }: { sp: Record<string, string | undefined> }) {
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.fim ?? "") ? sp.fim! : todayISO();
  const inicio = /^\d{4}-\d{2}-\d{2}$/.test(sp.inicio ?? "") ? sp.inicio! : `${fim.slice(0, 7)}-01`;
  const supabase = await createClient();
  const [{ data, error }, profiles] = await Promise.all([supabase.rpc("relatorio_leads", { p_inicio: inicio, p_fim: fim }), getProfileMap()]);
  if (error || !data) return <EmptyState title="Relatório indisponível" description="Você precisa da permissão de ver leads ou relatórios." />;
  const r = data as Relatorio;
  const total = r.por_origem.reduce((a, x) => a + Number(x.total), 0);
  const conv = r.por_origem.reduce((a, x) => a + Number(x.convertidos), 0);
  const taxa = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
  return (
    <div className="space-y-6">
      <form className="flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="tab" value="funil" />
        <label className="grid gap-1">De<input className="input" type="date" name="inicio" defaultValue={inicio} /></label>
        <label className="grid gap-1">Até<input className="input" type="date" name="fim" defaultValue={fim} /></label>
        <button className="rounded-xl border border-line px-4 py-2 font-semibold">Filtrar</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Leads no período" value={total} icon={<UserPlus className="h-5 w-5" />} />
        <StatCard label="Conversão" value={taxa(conv, total)} tone="green" hint={`${conv} convertido(s)`} />
        <StatCard label="Tempo até o 1º contato" value={r.tempo_medio.ate_contato_min != null ? `${r.tempo_medio.ate_contato_min} min` : "—"} tone="accent" />
        <StatCard label="Tempo até a conversão" value={r.tempo_medio.ate_conversao_h != null ? `${r.tempo_medio.ate_conversao_h} h` : "—"} tone="amber" />
      </div>
      <Card>
        <CardHeader title="Por origem e campanha" description="Use para comparar o retorno das campanhas" icon={<Filter className="h-4 w-4" />} />
        <div className="overflow-x-auto"><table className="table-base">
          <thead><tr><th>Origem</th><th>Campanha</th><th className="text-right">Leads</th><th className="text-right">Convertidos</th><th className="text-right">Conversão</th><th className="text-right">Descartados</th><th className="text-right">Score médio</th></tr></thead>
          <tbody>{r.por_origem.map((x, i) => (
            <tr key={i}><td>{origens[x.origem]?.label ?? x.origem}</td><td className="text-sm">{x.campanha}</td><td className="text-right">{x.total}</td><td className="text-right">{x.convertidos}</td><td className="text-right">{taxa(x.convertidos, x.total)}</td><td className="text-right">{x.descartados}</td><td className="text-right">{x.score_medio}</td></tr>
          ))}</tbody>
        </table></div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Por responsável" />
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Responsável</th><th className="text-right">Leads</th><th className="text-right">Conversão</th><th className="text-right">SLA estourado</th><th className="text-right">Min. até contato</th></tr></thead>
            <tbody>{r.por_responsavel.map((x, i) => (
              <tr key={i}><td>{x.responsavel_id ? profiles.get(x.responsavel_id)?.full_name ?? "—" : "Fila geral"}</td><td className="text-right">{x.total}</td><td className="text-right">{taxa(x.convertidos, x.total)}</td><td className="text-right">{x.sla_estourado}</td><td className="text-right">{x.min_ate_contato ?? "—"}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
        <Card className="self-start">
          <CardHeader title="Motivos de descarte" />
          {r.descartes.length === 0 ? <EmptyState title="Nenhum descarte" /> : (
            <ul className="divide-y divide-line text-sm">{r.descartes.map((d) => <li key={d.motivo} className="flex justify-between px-5 py-2.5"><span>{d.motivo}</span><span className="font-semibold">{d.total}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}

async function Regras() {
  const supabase = await createClient();
  const [{ data: regras }, usuarios, deps, { data: cfg }, profiles] = await Promise.all([
    supabase.from("distribuicao_regras").select("*").order("ordem"), userOptions(), departamentoOptions(),
    supabase.from("configuracoes").select("valor").eq("chave", "leads").maybeSingle(), getProfileMap(),
  ]);
  const crit = toMap(DISTRIBUICAO_CRITERIOS);
  const campos = [
    { name: "ordem", label: "Ordem", type: "number" as const, min: 1, max: 1000, required: true, span: 2 as const },
    { name: "nome", label: "Nome", required: true, span: 4 as const },
    { name: "criterio", label: "Quando", type: "select" as const, options: DISTRIBUICAO_CRITERIOS, required: true, span: 3 as const },
    { name: "valor", label: "Valor (cidade, DDD, origem…)", span: 3 as const },
    { name: "membros", label: "Quem recebe", type: "multiselect" as const, options: usuarios, span: 6 as const },
    { name: "departamento_id", label: "Ou a fila do departamento", type: "select" as const, options: deps, span: 3 as const },
    { name: "modo", label: "Como escolher", type: "select" as const, options: [{ value: "rodizio", label: "Rodízio" }, { value: "menor_carga", label: "Menor carga" }], required: true, span: 3 as const },
    { name: "aplica_leads", label: "Vale para leads", type: "checkbox" as const, span: 2 as const },
    { name: "aplica_whatsapp", label: "Vale para conversas de WhatsApp", type: "checkbox" as const, span: 2 as const },
    { name: "ativo", label: "Ativa", type: "checkbox" as const, span: 2 as const },
  ];
  const v = (cfg?.valor ?? {}) as { sla_minutos?: number; max_redistribuicoes?: number };
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="Regras de distribuição" description="Avaliadas em ordem. Cliente que já tem dono na carteira vai sempre para o dono." icon={<Share2 className="h-4 w-4" />}
          action={<FormDrawerButton action={salvarRegra} title="Nova regra" label="Nova regra" size="sm" values={{ ordem: (regras?.length ?? 0) + 1, criterio: "qualquer", modo: "rodizio", aplica_leads: true, aplica_whatsapp: true, ativo: true }} fields={campos} />} />
        {!regras?.length ? <EmptyState title="Nenhuma regra" description="Sem regras, leads e conversas sem dono ficam na fila geral." /> : (
          <ul className="divide-y divide-line">
            {regras.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{r.ordem}. {r.nome} {!r.ativo && <span className="text-xs text-muted">(inativa)</span>}</p>
                  <p className="text-xs text-muted">
                    {crit[r.criterio]?.label}{r.valor ? `: ${r.valor}` : ""} · {r.modo === "rodizio" ? "rodízio" : "menor carga"} entre {(r.membros as string[]).map((m) => profiles.get(m)?.full_name ?? "—").join(", ") || "a fila do departamento"}
                    {" · "}{[r.aplica_leads && "leads", r.aplica_whatsapp && "WhatsApp"].filter(Boolean).join(" e ")}
                  </p>
                </div>
                <FormDrawerButton action={salvarRegra} title="Editar regra" icon="edit" variant="ghost" size="sm" hidden={{ id: r.id }} values={r} fields={campos} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Prazo do primeiro contato" icon={<SlidersHorizontal className="h-4 w-4" />} />
        <CardBody>
          <SettingsForm action={salvarParametrosLeads} values={{ sla_minutos: v.sla_minutos ?? 15, max_redistribuicoes: v.max_redistribuicoes ?? 3 }}
            fields={[
              { name: "sla_minutos", label: "Minutos para o primeiro contato", type: "number", min: 1, max: 1440, required: true },
              { name: "max_redistribuicoes", label: "Redistribuições automáticas ao estourar", type: "number", min: 0, max: 10, required: true, help: "Depois disso o lead fica com o último responsável e o supervisor é avisado" },
            ]} />
        </CardBody>
      </Card>
    </div>
  );
}

async function Captacao() {
  const supabase = await createClient();
  const [{ data: forms }, { data: paginas }] = await Promise.all([
    supabase.from("lead_formularios").select("*").order("created_at"),
    supabase.from("meta_paginas").select("*").order("created_at"),
  ]);
  const camposForm = [
    { name: "titulo", label: "Título", required: true, span: 6 as const },
    { name: "slug", label: "Endereço (/f/…)", required: true, span: 3 as const, placeholder: "consorcio-imovel" },
    { name: "campanha", label: "Campanha", span: 3 as const },
    { name: "descricao", label: "Texto de apresentação", type: "textarea" as const, rows: 2, span: 6 as const },
    { name: "interesses", label: "Opções de interesse (uma por linha)", type: "textarea" as const, rows: 3, span: 6 as const },
    { name: "mensagem_sucesso", label: "Mensagem após o envio", span: 6 as const },
    { name: "pedir_documento", label: "Pedir CPF", type: "checkbox" as const, span: 2 as const },
    { name: "pedir_renda", label: "Pedir renda", type: "checkbox" as const, span: 2 as const },
    { name: "ativo", label: "Ativo", type: "checkbox" as const, span: 2 as const },
  ];
  const camposPagina = [
    { name: "nome", label: "Nome da página", required: true, span: 6 as const },
    { name: "page_id", label: "ID da página (Meta)", required: true, span: 3 as const },
    { name: "campanha_padrao", label: "Campanha padrão", span: 3 as const },
    { name: "token", label: "Token de acesso da página", type: "password" as const, span: 6 as const, help: "Guardado criptografado; deixe vazio para manter o atual" },
    { name: "ativo", label: "Ativa", type: "checkbox" as const, span: 6 as const },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="self-start">
        <CardHeader title="Formulários públicos" description="Link para campanhas, bio e QR code. Protegido contra robôs e com consentimento LGPD." icon={<Link2 className="h-4 w-4" />}
          action={<FormDrawerButton action={salvarFormulario} title="Novo formulário" label="Novo" size="sm" values={{ ativo: true }} fields={camposForm} />} />
        {!forms?.length ? <EmptyState title="Nenhum formulário" /> : (
          <ul className="divide-y divide-line">
            {forms.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{f.titulo} {!f.ativo && <span className="text-xs text-muted">(inativo)</span>}</p>
                  <a href={`/f/${f.slug}`} target="_blank" rel="noopener" className="break-all text-xs text-brand-600">{env.siteUrl}/f/{f.slug}</a>
                </div>
                <FormDrawerButton action={salvarFormulario} title="Editar formulário" icon="edit" variant="ghost" size="sm" hidden={{ id: f.id }} values={{ ...f, interesses: (f.interesses as string[]).join("\n") }} fields={camposForm} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Facebook / Instagram Lead Ads" description={`Webhook: ${env.siteUrl}/api/webhooks/meta (evento leadgen)`} icon={<Share2 className="h-4 w-4" />}
          action={<FormDrawerButton action={salvarPaginaMeta} title="Conectar página" label="Conectar" size="sm" values={{ ativo: true }} fields={camposPagina} />} />
        {!paginas?.length ? <EmptyState title="Nenhuma página conectada" description="Os leads dos anúncios entram sozinhos, com campanha e anúncio de origem." /> : (
          <ul className="divide-y divide-line">
            {paginas.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div><p className="font-medium">{p.nome} {!p.ativo && <span className="text-xs text-muted">(inativa)</span>}</p><p className="text-xs text-muted">ID {p.page_id}{p.campanha_padrao ? ` · ${p.campanha_padrao}` : ""}</p></div>
                <FormDrawerButton action={salvarPaginaMeta} title="Editar página" icon="edit" variant="ghost" size="sm" hidden={{ id: p.id }} values={p} fields={camposPagina} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
