import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle, Paperclip, StickyNote } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { departamentoOptions, getProfileMap, userOptions } from "@/lib/data";
import { WA_CONVERSA_STATUS, WA_RESULTADOS } from "@/lib/constants";
import { dateTime, maskPhone, relative } from "@/lib/format";
import { cn } from "@/lib/cn";
import { assumirConversa, encerrarConversa, registrarNota, registrarOptin, salvarEtiquetas, transferirConversa } from "@/lib/actions/whatsapp";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { RealtimeRefresh } from "@/components/ui/realtime-refresh";
import { Composer } from "@/components/whatsapp/composer";

export const metadata: Metadata = { title: "WhatsApp" };

type Conversa = {
  id: string; status: string; atendente_id: string | null; departamento_id: string | null; janela_ate: string | null; ultima_mensagem_em: string | null;
  sla_ate: string | null; primeira_resposta_em: string | null; prioridade: number;
  wa_contatos: { id: string; telefone: string; nome: string | null; cliente_id: string | null; lead_id: string | null; optin_em: string | null; optout_em: string | null; etiquetas: string[] };
};
type Mensagem = { id: string; direcao: string; tipo: string; conteudo: string | null; midia_path: string | null; midia_mime: string | null; midia_nome: string | null; status: string; erro: string | null; autor_id: string | null; created_at: string };

const FILTROS = [
  { key: "minhas", label: "Minhas" },
  { key: "fila", label: "Fila" },
  { key: "todas", label: "Em aberto" },
  { key: "encerradas", label: "Encerradas" },
];
const tel = (t: string) => (t.startsWith("55") ? maskPhone(t.slice(2)) : `+${t}`);

/** Caixa de entrada: conversas da sua fila/carteira (o RLS decide o que cada um vê), em tempo real. */
export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requireSession();
  if (!can(profile, "whatsapp.atender") && !can(profile, "whatsapp.supervisionar")) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const filtro = FILTROS.some((f) => f.key === sp.f) ? sp.f! : "minhas";
  const supabase = await createClient();
  let q = supabase.from("wa_conversas")
    .select("id, status, atendente_id, departamento_id, janela_ate, ultima_mensagem_em, sla_ate, primeira_resposta_em, prioridade, wa_contatos(id, telefone, nome, cliente_id, lead_id, optin_em, optout_em, etiquetas)")
    .order("prioridade", { ascending: false }).order("ultima_mensagem_em", { ascending: false, nullsFirst: false }).limit(80);
  if (filtro === "encerradas") q = q.in("status", ["resolvida", "arquivada"]);
  else {
    q = q.not("status", "in", "(resolvida,arquivada)");
    if (filtro === "minhas") q = q.eq("atendente_id", userId);
    if (filtro === "fila") q = q.is("atendente_id", null);
  }
  const selecionada = sp.c && /^[0-9a-f-]{36}$/i.test(sp.c) ? sp.c : null;
  const [{ data: lista }, profiles, { data: sel }, { count: naFila }] = await Promise.all([
    q, getProfileMap(),
    selecionada ? supabase.from("wa_conversas").select("id, status, atendente_id, departamento_id, janela_ate, ultima_mensagem_em, sla_ate, primeira_resposta_em, prioridade, wa_contatos(id, telefone, nome, cliente_id, lead_id, optin_em, optout_em, etiquetas)").eq("id", selecionada).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("wa_conversas").select("id", { count: "exact", head: true }).is("atendente_id", null).not("status", "in", "(resolvida,arquivada)"),
  ]);
  const conversas = (lista ?? []) as unknown as Conversa[];
  const atual = sel as unknown as Conversa | null;
  const agora = Date.now();
  const linkFiltro = (f: string) => `/whatsapp?f=${f}${atual ? `&c=${atual.id}` : ""}`;

  return (
    <>
      <RealtimeRefresh tabelas={["wa_conversas", "wa_mensagens"]} intervaloSeg={30} />
      <PageHeader eyebrow="Atendimento" title="WhatsApp" description="Conversas do número oficial da empresa. Cliente com dono na carteira cai direto com o consultor; os demais seguem as regras de distribuição." />
      <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="card flex flex-col overflow-hidden">
          <nav className="flex gap-1 border-b border-line p-2 text-sm">
            {FILTROS.map((f) => (
              <Link key={f.key} href={linkFiltro(f.key)} className={cn("rounded-lg px-3 py-1.5 font-medium", filtro === f.key ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100" : "text-muted hover:text-fg")}>
                {f.label}{f.key === "fila" && naFila ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[11px] text-amber-800">{naFila}</span> : null}
              </Link>
            ))}
          </nav>
          {conversas.length === 0 ? <EmptyState icon={<MessageCircle className="h-6 w-6" />} title="Nenhuma conversa" /> : (
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {conversas.map((c) => {
                const slaVencido = !c.primeira_resposta_em && c.sla_ate && new Date(c.sla_ate).getTime() < agora;
                return (
                  <li key={c.id}>
                    <Link href={`/whatsapp?f=${filtro}&c=${c.id}`} className={cn("block px-4 py-3 hover:bg-surface-2", atual?.id === c.id && "bg-surface-2")}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium">{c.wa_contatos.nome ?? tel(c.wa_contatos.telefone)}</p>
                        <span className="shrink-0 text-[11px] text-muted">{c.ultima_mensagem_em ? relative(c.ultima_mensagem_em) : ""}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <StatusBadge options={WA_CONVERSA_STATUS} value={c.status} />
                        {slaVencido && <span className="font-semibold text-red-600">SLA</span>}
                        {c.wa_contatos.cliente_id && <span className="text-muted">cliente</span>}
                        {c.atendente_id && c.atendente_id !== userId && <span className="truncate text-muted">{profiles.get(c.atendente_id)?.full_name}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
        <section className="card flex min-w-0 flex-col overflow-hidden">
          {atual ? <ConversaAberta c={atual} userId={userId} profiles={profiles} supervisiona={can(profile, "whatsapp.supervisionar")} /> : (
            <div className="grid flex-1 place-items-center"><EmptyState icon={<MessageCircle className="h-6 w-6" />} title="Escolha uma conversa" description="As mensagens chegam em tempo real." /></div>
          )}
        </section>
      </div>
    </>
  );
}

async function ConversaAberta({ c, userId, profiles, supervisiona }: { c: Conversa; userId: string; profiles: Awaited<ReturnType<typeof getProfileMap>>; supervisiona: boolean }) {
  const supabase = await createClient();
  const [{ data: msgs }, { data: modelos }, usuarios, deps] = await Promise.all([
    supabase.from("wa_mensagens").select("id, direcao, tipo, conteudo, midia_path, midia_mime, midia_nome, status, erro, autor_id, created_at").eq("conversa_id", c.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("wa_modelos").select("id, nome, corpo, variaveis, categoria").eq("status", "aprovado").order("nome"),
    userOptions(), departamentoOptions(),
  ]);
  const mensagens = ((msgs ?? []) as Mensagem[]).reverse();
  const ct = c.wa_contatos;
  const janelaAberta = !!c.janela_ate && new Date(c.janela_ate).getTime() > Date.now();
  const encerrada = ["resolvida", "arquivada"].includes(c.status);
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <p className="font-semibold">{ct.nome ?? tel(ct.telefone)} <span className="text-xs font-normal text-muted">{tel(ct.telefone)}</span></p>
          <p className="text-xs text-muted">
            {c.atendente_id ? `Com ${profiles.get(c.atendente_id)?.full_name ?? "—"}` : "Na fila"}
            {" · "}{janelaAberta ? `janela aberta até ${dateTime(c.janela_ate)}` : "fora da janela de 24 h"}
            {ct.optout_em ? " · descadastrado" : ct.optin_em ? " · autorizou mensagens" : ""}
            {ct.etiquetas.length ? ` · ${ct.etiquetas.join(", ")}` : ""}
          </p>
          <div className="mt-1 flex gap-3 text-xs font-semibold">
            {ct.cliente_id && <Link href={`/clientes/${ct.cliente_id}`} className="text-brand-600">Ficha do cliente</Link>}
            {ct.lead_id && <Link href={`/leads?q=${encodeURIComponent(ct.telefone.slice(-8))}`} className="text-brand-600">Lead</Link>}
          </div>
        </div>
        {!encerrada && (
          <div className="flex flex-wrap gap-1">
            {(c.atendente_id !== userId) && <ActionButton action={assumirConversa.bind(null, c.id)} label="Assumir" variant="primary" />}
            <FormDrawerButton action={transferirConversa} title="Transferir conversa" label="Transferir" icon="none" variant="outline" size="sm" hidden={{ conversa_id: c.id }}
              fields={[
                { name: "atendente_id", label: "Para o atendente", type: "select", options: usuarios, span: 6 },
                { name: "departamento_id", label: "Ou para a fila do departamento", type: "select", options: deps, span: 6 },
                { name: "nota", label: "Nota para quem recebe", type: "textarea", rows: 3, span: 6 },
              ]} />
            <FormDrawerButton action={registrarNota} title="Nota interna" label="Nota" icon="none" variant="ghost" size="sm" hidden={{ conversa_id: c.id }}
              fields={[{ name: "texto", label: "Nota (o cliente não vê)", type: "textarea", rows: 4, required: true, span: 6 }]} />
            <FormDrawerButton action={salvarEtiquetas} title="Etiquetas" label="Etiquetas" icon="none" variant="ghost" size="sm" hidden={{ conversa_id: c.id }} values={{ etiquetas: ct.etiquetas.join(", "), prioridade: c.prioridade }}
              fields={[{ name: "etiquetas", label: "Etiquetas (separadas por vírgula)", span: 6 }]} />
            {!ct.optin_em || ct.optout_em
              ? <ActionButton action={registrarOptin.bind(null, ct.id, true)} label="Registrar opt-in" variant="ghost" title="O cliente autorizou receber mensagens (campanhas)" />
              : <ActionButton action={registrarOptin.bind(null, ct.id, false)} label="Descadastrar" variant="ghost" />}
            <FormDrawerButton action={encerrarConversa} title="Encerrar atendimento" label="Encerrar" icon="none" variant="secondary" size="sm" hidden={{ conversa_id: c.id }}
              fields={[
                { name: "resultado", label: "Resultado", type: "select", options: WA_RESULTADOS, required: true, span: 6 },
                { name: "motivo", label: "Observação", span: 6 },
              ]} />
          </div>
        )}
      </header>
      <ol className="flex flex-1 flex-col gap-2 overflow-y-auto bg-surface-2/50 p-4">
        {mensagens.map((m) => (
          <li key={m.id} className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
            m.direcao === "entrada" ? "self-start bg-surface" : m.direcao === "nota" ? "self-center bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : "self-end bg-emerald-50 dark:bg-emerald-950/40")}>
            {m.direcao === "nota" && <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold"><StickyNote className="h-3 w-3" />Nota interna · {m.autor_id ? profiles.get(m.autor_id)?.full_name : ""}</p>}
            {m.midia_path && (
              m.midia_mime?.startsWith("image/")
                // eslint-disable-next-line @next/next/no-img-element
                ? <a href={`/api/whatsapp/midia/${m.id}`} target="_blank" rel="noopener"><img src={`/api/whatsapp/midia/${m.id}`} alt="Imagem recebida" className="mb-1 max-h-60 rounded-lg" /></a>
                : <a href={`/api/whatsapp/midia/${m.id}`} target="_blank" rel="noopener" className="mb-1 flex items-center gap-1 font-semibold text-brand-600"><Paperclip className="h-4 w-4" />{m.midia_nome ?? m.tipo}</a>
            )}
            {m.conteudo && <p className="whitespace-pre-wrap break-words">{m.conteudo}</p>}
            <p className="mt-1 text-right text-[10px] text-muted">
              {dateTime(m.created_at)}
              {m.direcao === "saida" && ` · ${m.autor_id ? profiles.get(m.autor_id)?.full_name?.split(" ")[0] ?? "" : "automática"} · ${m.status}`}
              {m.erro && <span className="block text-red-600">{m.erro}</span>}
            </p>
          </li>
        ))}
      </ol>
      {!encerrada && (c.atendente_id === userId || !c.atendente_id || supervisiona) && (
        <Composer conversaId={c.id} janelaAberta={janelaAberta} modelos={(modelos ?? []) as { id: string; nome: string; corpo: string; variaveis: number; categoria: string }[]} />
      )}
    </>
  );
}
