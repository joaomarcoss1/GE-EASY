import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarCheck, Clock, MapPin, ShieldCheck } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { APROVACAO_STATUS, AUSENCIA_TIPOS, PONTO_TIPOS, toMap } from "@/lib/constants";
import { date, dateTime, todayISO } from "@/lib/format";
import { darCiencia, decidirAjuste, decidirAusencia, fecharEspelho, salvarCerca, salvarJornada, salvarParametrosPonto, solicitarAjuste, solicitarAusencia } from "@/lib/actions/rh";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { LinkTabs } from "@/components/ui/tabs";
import { SettingsForm } from "@/components/configuracoes/settings-form";
import { PontoWeb } from "@/components/rh/ponto-web";
import type { FieldDef } from "@/components/ui/form";

export const metadata: Metadata = { title: "Ponto" };

const tipos = toMap(PONTO_TIPOS);
const ausTipos = toMap(AUSENCIA_TIPOS);
const hm = (min: number) => `${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, "0")}`;
const DIAS = [{ value: "1", label: "Seg" }, { value: "2", label: "Ter" }, { value: "3", label: "Qua" }, { value: "4", label: "Qui" }, { value: "5", label: "Sex" }, { value: "6", label: "Sáb" }, { value: "7", label: "Dom" }];
const ALERTAS: Record<string, string> = { sem_saida: "sem saída", intervalo_sem_retorno: "intervalo sem retorno", intervalo_nao_cumprido: "intervalo não cumprido" };

type Dia = { data: string; marcacoes: { tipo: string; hora: string; offline: boolean; fora_cerca: boolean; ajuste: boolean }[]; trabalhado_min: number; esperado_min: number; extras_min: number; atraso_min: number; debito_min: number; falta: boolean; ausencia: string | null; alertas: string[] };
type Espelho = { funcionario: { nome: string; matricula: string | null; cargo: string | null }; competencia: string; dias: Dia[]; totais: { trabalhado_min: number; extras_min: number; atraso_min: number; debito_min: number; faltas: number; saldo_min: number } };

/**
 * Ponto do funcionário: marcar (horário do servidor, localização só no ato), espelho do mês com ciência,
 * pedidos de ajuste/ausência. Para a gestão: aprovações, jornadas, cercas e fechamento dos espelhos.
 * Controle interno de jornada — para valer como REP-P (Portaria 671/2021) valide com a assessoria trabalhista.
 */
export default async function PontoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requireSession();
  const gere = can(profile, "ponto.gerir");
  if (!can(profile, "ponto.registrar") && !gere) redirect("/inicio?erro=permissao");
  const sp = await searchParams;
  const tabs = [
    { key: "hoje", label: "Hoje" },
    { key: "espelho", label: "Meu espelho" },
    { key: "pedidos", label: "Meus pedidos" },
    ...(gere ? [{ key: "aprovacoes", label: "Aprovações" }, { key: "espelhos", label: "Espelhos da equipe" }, { key: "jornadas", label: "Jornadas e cercas" }] : []),
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "hoje";
  const supabase = await createClient();
  const { data: meu } = await supabase.rpc("meu_funcionario");
  const funcId = meu as string | null;
  return (
    <>
      <PageHeader eyebrow="RH" title="Ponto" description="Entrada, intervalo e saída com o horário do servidor. A localização é registrada só no momento da marcação." />
      <LinkTabs base="/ponto" tabs={tabs} active={tab} />
      {tab === "hoje" && <Hoje funcId={funcId} />}
      {tab === "espelho" && (funcId ? <MeuEspelho funcId={funcId} mes={sp.mes} /> : <SemCadastro />)}
      {tab === "pedidos" && (funcId ? <Pedidos funcId={funcId} /> : <SemCadastro />)}
      {tab === "aprovacoes" && gere && <Aprovacoes />}
      {tab === "espelhos" && gere && <EspelhosEquipe sp={sp} />}
      {tab === "jornadas" && gere && <Jornadas />}
    </>
  );
}

const SemCadastro = () => <EmptyState title="Cadastro de funcionário não encontrado" description="Peça ao RH para vincular seu usuário a um cadastro de funcionário." />;

async function Hoje({ funcId }: { funcId: string | null }) {
  if (!funcId) return <SemCadastro />;
  const supabase = await createClient();
  const hoje = todayISO();
  const { data } = await supabase.from("ponto_marcacoes").select("id, tipo, horario, nsr, offline, fora_cerca, origem, flags").eq("funcionario_id", funcId)
    .gte("horario", `${hoje}T00:00:00-03:00`).order("horario");
  const marcas = data ?? [];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Registrar marcação" description="O botão destacado é a próxima marcação esperada." icon={<Clock className="h-4 w-4" />} />
        <CardBody><PontoWeb ultima={marcas[marcas.length - 1]?.tipo} /></CardBody>
      </Card>
      <Card className="self-start">
        <CardHeader title="Marcações de hoje" icon={<MapPin className="h-4 w-4" />} />
        {marcas.length === 0 ? <EmptyState title="Nenhuma marcação hoje" /> : (
          <ul className="divide-y divide-line text-sm">
            {marcas.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-5 py-2.5">
                <span>{tipos[m.tipo]?.label}{m.offline && <span className="ml-1 text-xs text-amber-600">offline</span>}{m.fora_cerca && <span className="ml-1 text-xs text-amber-600">fora da área</span>}{m.origem === "ajuste" && <span className="ml-1 text-xs text-muted">ajuste</span>}</span>
                <span className="font-mono">{new Date(m.horario).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" })} <span className="text-[10px] text-muted">NSR {m.nsr}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TabelaEspelho({ e }: { e: Espelho }) {
  return (
    <>
      <div className="grid gap-2 border-b border-line p-4 text-sm sm:grid-cols-5">
        <p>Trabalhado <b>{hm(e.totais.trabalhado_min)}</b></p>
        <p>Extras <b>{hm(e.totais.extras_min)}</b></p>
        <p>Débitos <b>{hm(e.totais.debito_min)}</b></p>
        <p>Faltas <b>{e.totais.faltas}</b></p>
        <p>Saldo <b className={e.totais.saldo_min < 0 ? "text-red-600" : "text-emerald-700"}>{e.totais.saldo_min < 0 ? "-" : ""}{hm(e.totais.saldo_min)}</b></p>
      </div>
      <div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Dia</th><th>Marcações</th><th className="text-right">Trabalhado</th><th className="text-right">Esperado</th><th className="text-right">Extras</th><th className="text-right">Débito</th><th>Ocorrências</th></tr></thead>
        <tbody>{e.dias.map((d) => (
          <tr key={d.data} className={d.esperado_min === 0 && !d.marcacoes.length ? "text-muted" : ""}>
            <td className="whitespace-nowrap text-sm">{date(d.data)}</td>
            <td className="text-sm">{d.marcacoes.map((m) => `${m.hora}${m.ajuste ? "*" : ""}${m.offline ? "ᵒ" : ""}`).join("  ") || "—"}</td>
            <td className="text-right text-sm">{d.trabalhado_min ? hm(d.trabalhado_min) : "—"}</td>
            <td className="text-right text-sm">{d.esperado_min ? hm(d.esperado_min) : "—"}</td>
            <td className="text-right text-sm">{d.extras_min ? hm(d.extras_min) : ""}</td>
            <td className="text-right text-sm text-red-600">{d.debito_min ? hm(d.debito_min) : ""}</td>
            <td className="text-xs">{[d.falta && "falta", d.ausencia && ausTipos[d.ausencia]?.label, d.atraso_min > 0 && `atraso ${d.atraso_min} min`, ...d.alertas.map((a) => ALERTAS[a] ?? a)].filter(Boolean).join(" · ")}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="px-5 py-3 text-xs text-muted">* marcação incluída por ajuste aprovado · ᵒ registrada sem internet (horário do aparelho)</p>
    </>
  );
}

async function MeuEspelho({ funcId, mes }: { funcId: string; mes?: string }) {
  const comp = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : todayISO().slice(0, 7);
  const supabase = await createClient();
  const [{ data, error }, { data: fechados }] = await Promise.all([
    supabase.rpc("espelho_ponto", { p_func: funcId, p_competencia: `${comp}-01` }),
    supabase.from("ponto_espelhos").select("id, competencia, ciencia_em, contestacao, gerado_em").eq("funcionario_id", funcId).order("competencia", { ascending: false }).limit(12),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title={`Espelho de ${comp.slice(5)}/${comp.slice(0, 4)}`} icon={<CalendarCheck className="h-4 w-4" />}
          action={<form className="flex gap-2"><input type="hidden" name="tab" value="espelho" /><input className="input" type="month" name="mes" defaultValue={comp} /><button className="rounded-xl border border-line px-3 text-sm font-semibold">Ver</button></form>} />
        {error || !data ? <EmptyState title="Espelho indisponível" /> : <TabelaEspelho e={data as Espelho} />}
      </Card>
      <Card className="self-start">
        <CardHeader title="Espelhos fechados" description="Registre a ciência ou conteste com o motivo." icon={<ShieldCheck className="h-4 w-4" />} />
        {!fechados?.length ? <EmptyState title="Nenhum espelho fechado" /> : (
          <ul className="divide-y divide-line text-sm">
            {fechados.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <div><p className="font-medium">{date(f.competencia).slice(3)}</p><p className="text-xs text-muted">{f.ciencia_em ? `Ciência em ${dateTime(f.ciencia_em)}` : f.contestacao ? "Contestado — aguardando RH" : "Aguardando sua ciência"}</p></div>
                {!f.ciencia_em && (
                  <FormDrawerButton action={darCiencia} title="Ciência do espelho" label="Responder" icon="none" variant="outline" size="sm" hidden={{ id: f.id }} submitLabel="Enviar"
                    description="Deixe em branco para registrar a ciência. Se algo estiver errado, descreva para o RH."
                    fields={[{ name: "contestacao", label: "Contestação (opcional)", type: "textarea", rows: 4, span: 6 }]} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const camposAjuste = (marcacoes: { value: string; label: string }[]): FieldDef[] => [
  { name: "acao", label: "Pedido", type: "select", options: [{ value: "incluir", label: "Incluir marcação esquecida" }, { value: "desconsiderar", label: "Desconsiderar marcação errada" }], required: true, span: 6 },
  { name: "tipo", label: "Tipo (inclusão)", type: "select", options: PONTO_TIPOS, span: 2 },
  { name: "data", label: "Data (inclusão)", type: "date", span: 2 },
  { name: "hora", label: "Hora (inclusão)", type: "time", span: 2 },
  { name: "marcacao_id", label: "Marcação (desconsiderar)", type: "select", options: marcacoes, span: 6 },
  { name: "justificativa", label: "Justificativa", type: "textarea", rows: 3, required: true, span: 6 },
];
const camposAusencia: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", options: AUSENCIA_TIPOS, required: true, span: 6 },
  { name: "inicio", label: "De", type: "date", required: true, span: 3 },
  { name: "fim", label: "Até", type: "date", required: true, span: 3 },
  { name: "observacao", label: "Observação", type: "textarea", rows: 2, span: 6 },
  { name: "arquivo", label: "Anexo (atestado, comprovante)", type: "file", placeholder: "application/pdf,image/jpeg,image/png,image/webp", span: 6, help: "PDF ou imagem até 10 MB. Atestados só são vistos pelo RH autorizado." },
];

async function Pedidos({ funcId }: { funcId: string }) {
  const supabase = await createClient();
  const [{ data: ajustes }, { data: ausencias }, { data: recentes }] = await Promise.all([
    supabase.from("ponto_ajustes").select("*").eq("funcionario_id", funcId).order("created_at", { ascending: false }).limit(30),
    supabase.from("ausencias").select("id, tipo, inicio, fim, status, observacao").eq("funcionario_id", funcId).order("inicio", { ascending: false }).limit(30),
    supabase.from("ponto_marcacoes").select("id, tipo, horario").eq("funcionario_id", funcId).gte("horario", new Date(Date.now() - 40 * 86400_000).toISOString()).order("horario", { ascending: false }).limit(60),
  ]);
  const opMarc = (recentes ?? []).map((m) => ({ value: m.id, label: `${dateTime(m.horario)} · ${tipos[m.tipo]?.label}` }));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="self-start">
        <CardHeader title="Ajustes de ponto" description="A marcação original nunca é apagada; o ajuste vale após aprovação."
          action={<FormDrawerButton action={solicitarAjuste} title="Pedir ajuste" label="Pedir ajuste" size="sm" values={{ acao: "incluir" }} fields={camposAjuste(opMarc)} />} />
        {!ajustes?.length ? <EmptyState title="Nenhum pedido" /> : (
          <ul className="divide-y divide-line text-sm">{ajustes.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 px-5 py-3">
              <div className="min-w-0"><p className="font-medium">{a.acao === "incluir" ? `Incluir ${tipos[a.tipo]?.label?.toLowerCase()} em ${dateTime(a.horario)}` : "Desconsiderar marcação"}</p><p className="text-xs text-muted">{a.justificativa}{a.observacao_decisao ? ` — RH: ${a.observacao_decisao}` : ""}</p></div>
              <StatusBadge options={APROVACAO_STATUS} value={a.status} />
            </li>
          ))}</ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Férias, atestados e ausências" action={<FormDrawerButton action={solicitarAusencia} title="Nova solicitação" label="Solicitar" size="sm" fields={camposAusencia} />} />
        {!ausencias?.length ? <EmptyState title="Nenhuma solicitação" /> : (
          <ul className="divide-y divide-line text-sm">{ausencias.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-3">
              <div><p className="font-medium">{ausTipos[a.tipo]?.label}</p><p className="text-xs text-muted">{date(a.inicio)} a {date(a.fim)}</p></div>
              <StatusBadge options={APROVACAO_STATUS} value={a.status} />
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

async function Aprovacoes() {
  const supabase = await createClient();
  const [{ data: ajustes }, { data: ausencias }, { data: contestados }] = await Promise.all([
    supabase.from("ponto_ajustes").select("*, funcionarios(nome)").eq("status", "pendente").order("created_at").limit(100),
    supabase.from("ausencias").select("id, tipo, inicio, fim, observacao, anexo_path, funcionarios(nome)").eq("status", "pendente").order("inicio").limit(100),
    supabase.from("ponto_espelhos").select("id, competencia, contestacao, funcionarios(nome)").not("contestacao", "is", null).is("ciencia_em", null).limit(50),
  ]);
  const nome = (x: unknown) => (x as { nome: string } | null)?.nome ?? "—";
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="self-start">
        <CardHeader title="Ajustes pendentes" description="Quem pede não pode aprovar o próprio ajuste." />
        {!ajustes?.length ? <EmptyState title="Nada pendente" /> : (
          <ul className="divide-y divide-line text-sm">{ajustes.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 px-5 py-3">
              <div className="min-w-0"><p className="font-medium">{nome(a.funcionarios)}</p><p className="text-xs text-muted">{a.acao === "incluir" ? `Incluir ${tipos[a.tipo]?.label?.toLowerCase()} em ${dateTime(a.horario)}` : "Desconsiderar marcação"} — {a.justificativa}</p></div>
              <FormDrawerButton action={decidirAjuste} title="Decidir ajuste" label="Decidir" icon="none" variant="outline" size="sm" hidden={{ id: a.id }}
                fields={[{ name: "aprovar", label: "Decisão", type: "select", options: [{ value: "sim", label: "Aprovar" }, { value: "nao", label: "Recusar" }], required: true, span: 6 }, { name: "observacao", label: "Observação (obrigatória para recusar)", type: "textarea", rows: 2, span: 6 }]} />
            </li>
          ))}</ul>
        )}
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Ausências pendentes" />
          {!ausencias?.length ? <EmptyState title="Nada pendente" /> : (
            <ul className="divide-y divide-line text-sm">{ausencias.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0"><p className="font-medium">{nome(a.funcionarios)} · {ausTipos[a.tipo]?.label}</p><p className="text-xs text-muted">{date(a.inicio)} a {date(a.fim)}{a.observacao ? ` · ${a.observacao}` : ""}</p>
                  {a.anexo_path && <a href={`/api/rh/arquivo?ausencia=${a.id}`} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-600">Ver anexo</a>}</div>
                <div className="flex gap-1"><ActionButton action={decidirAusencia.bind(null, a.id, true)} label="Aprovar" variant="primary" /><ActionButton action={decidirAusencia.bind(null, a.id, false)} label="Recusar" variant="ghost" /></div>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Espelhos contestados" />
          {!contestados?.length ? <EmptyState title="Nenhuma contestação" /> : (
            <ul className="divide-y divide-line text-sm">{contestados.map((c) => <li key={c.id} className="px-5 py-3"><p className="font-medium">{nome(c.funcionarios)} · {date(c.competencia).slice(3)}</p><p className="text-xs text-muted">{c.contestacao}</p></li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}

async function EspelhosEquipe({ sp }: { sp: Record<string, string | undefined> }) {
  const supabase = await createClient();
  const anterior = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 7);
  const comp = /^\d{4}-\d{2}$/.test(sp.mes ?? "") ? sp.mes! : anterior;
  const { data: funcs } = await supabase.from("funcionarios").select("id, nome, matricula").neq("status", "desligado").eq("controla_ponto", true).order("nome");
  const sel = funcs?.find((f) => f.id === sp.f) ?? funcs?.[0];
  const [{ data: esp }, { data: fechado }] = sel
    ? await Promise.all([
        supabase.rpc("espelho_ponto", { p_func: sel.id, p_competencia: `${comp}-01` }),
        supabase.from("ponto_espelhos").select("id, ciencia_em, contestacao, gerado_em").eq("funcionario_id", sel.id).eq("competencia", `${comp}-01`).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  return (
    <Card>
      <CardHeader title={sel ? `${sel.nome} — ${comp.slice(5)}/${comp.slice(0, 4)}` : "Espelhos"} description={fechado ? (fechado.ciencia_em ? `Fechado; ciência em ${dateTime(fechado.ciencia_em)}` : fechado.contestacao ? "Fechado; contestado pelo funcionário" : "Fechado; aguardando ciência") : "Ainda não fechado"}
        action={sel && <FormDrawerButton action={fecharEspelho} title="Fechar espelho" label="Fechar e enviar" icon="none" size="sm" hidden={{ funcionario_id: sel.id, competencia: comp }} submitLabel="Fechar" description="O espelho é guardado com hash e enviado ao funcionário para ciência. Só meses encerrados." fields={[]} />} />
      <form className="flex flex-wrap gap-2 border-b border-line p-4">
        <input type="hidden" name="tab" value="espelhos" />
        <select className="input max-w-xs" name="f" defaultValue={sel?.id}>{(funcs ?? []).map((f) => <option key={f.id} value={f.id}>{f.nome}{f.matricula ? ` (${f.matricula})` : ""}</option>)}</select>
        <input className="input max-w-44" type="month" name="mes" defaultValue={comp} />
        <button className="rounded-xl border border-line px-4 text-sm font-semibold">Ver</button>
      </form>
      {esp ? <TabelaEspelho e={esp as Espelho} /> : <EmptyState title="Sem funcionários com controle de ponto" />}
    </Card>
  );
}

async function Jornadas() {
  const supabase = await createClient();
  const [{ data: jornadas }, { data: cercas }, { data: cfg }] = await Promise.all([
    supabase.from("jornadas").select("*").order("nome"), supabase.from("cercas").select("*").order("nome"),
    supabase.from("configuracoes").select("valor").eq("chave", "ponto").maybeSingle(),
  ]);
  const camposJ: FieldDef[] = [
    { name: "nome", label: "Nome", required: true, span: 6 },
    { name: "entrada", label: "Entrada", type: "time", required: true, span: 2 },
    { name: "saida", label: "Saída", type: "time", required: true, span: 2 },
    { name: "intervalo_min", label: "Intervalo (min)", type: "number", min: 0, max: 600, span: 2 },
    { name: "dias", label: "Dias de trabalho", type: "multiselect", options: DIAS, span: 6 },
    { name: "tolerancia_min", label: "Tolerância diária (min)", type: "number", min: 0, max: 60, span: 3, help: "CLT: até 10 min/dia não contam como extra nem atraso" },
    { name: "banco_horas", label: "Banco de horas", type: "checkbox", span: 3 },
    { name: "ativo", label: "Ativa", type: "checkbox", span: 6 },
  ];
  const camposC: FieldDef[] = [
    { name: "nome", label: "Nome (sede, filial…)", required: true, span: 6 },
    { name: "lat", label: "Latitude", type: "number", step: "any", min: -90, max: 90, required: true, span: 2 },
    { name: "lng", label: "Longitude", type: "number", step: "any", min: -180, max: 180, required: true, span: 2 },
    { name: "raio_m", label: "Raio (m)", type: "number", min: 20, max: 5000, span: 2 },
    { name: "ativo", label: "Ativa", type: "checkbox", span: 6 },
  ];
  const p = (cfg?.valor ?? {}) as Record<string, unknown>;
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="self-start">
        <CardHeader title="Jornadas" action={<FormDrawerButton action={salvarJornada} title="Nova jornada" label="Nova" size="sm" values={{ entrada: "08:00", saida: "18:00", intervalo_min: 60, tolerancia_min: 10, dias: ["1", "2", "3", "4", "5"], ativo: true }} fields={camposJ} />} />
        {!jornadas?.length ? <EmptyState title="Nenhuma jornada" description="Sem jornada, o espelho não calcula extras nem faltas." /> : (
          <ul className="divide-y divide-line text-sm">{jornadas.map((j) => (
            <li key={j.id} className="flex items-center justify-between px-5 py-3">
              <div><p className="font-medium">{j.nome}</p><p className="text-xs text-muted">{String(j.entrada).slice(0, 5)}–{String(j.saida).slice(0, 5)} · {j.intervalo_min} min · {(j.dias as number[]).map((d) => DIAS[d - 1]?.label).join(", ")}</p></div>
              <FormDrawerButton action={salvarJornada} title="Editar jornada" icon="edit" variant="ghost" size="sm" hidden={{ id: j.id }} fields={camposJ}
                values={{ ...j, entrada: String(j.entrada).slice(0, 5), saida: String(j.saida).slice(0, 5), dias: (j.dias as number[]).map(String) }} />
            </li>
          ))}</ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Cercas virtuais" description="Sede e filiais. Funcionário externo marca em qualquer lugar." action={<FormDrawerButton action={salvarCerca} title="Nova cerca" label="Nova" size="sm" values={{ raio_m: 150, ativo: true }} fields={camposC} />} />
        {!cercas?.length ? <EmptyState title="Nenhuma cerca" description="Sem cerca, a localização é só registrada." /> : (
          <ul className="divide-y divide-line text-sm">{cercas.map((c) => (
            <li key={c.id} className="flex items-center justify-between px-5 py-3">
              <div><p className="font-medium">{c.nome}</p><p className="text-xs text-muted">{c.lat}, {c.lng} · raio {c.raio_m} m</p></div>
              <FormDrawerButton action={salvarCerca} title="Editar cerca" icon="edit" variant="ghost" size="sm" hidden={{ id: c.id }} values={c} fields={camposC} />
            </li>
          ))}</ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Regras da marcação" />
        <CardBody>
          <SettingsForm action={salvarParametrosPonto} values={{ fora_cerca: (p.fora_cerca as string) ?? "registrar", precisao_max_m: (p.precisao_max_m as number) ?? 150, offline_max_h: (p.offline_max_h as number) ?? 72, exigir_gps: !!p.exigir_gps }}
            fields={[
              { name: "fora_cerca", label: "Fora da cerca", type: "select", options: [{ value: "registrar", label: "Registrar com sinal" }, { value: "bloquear", label: "Bloquear a marcação" }], required: true },
              { name: "precisao_max_m", label: "Precisão máxima do GPS (m)", type: "number", min: 10, max: 5000, required: true },
              { name: "offline_max_h", label: "Aceitar marcação offline de até (horas)", type: "number", min: 1, max: 168, required: true },
              { name: "exigir_gps", label: "Exigir localização", type: "checkbox" },
            ]} />
        </CardBody>
      </Card>
    </div>
  );
}
