import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Clock, Gauge, MapPin, Navigation, Receipt, Route, Smartphone, Wallet, X } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap } from "@/lib/data";
import { CADASTRO_STATUS, CARTEIRAS, CHECKIN_FLAGS, CHECKIN_RESULTADOS, DESPESA_STATUS, DESPESA_TIPOS, PARADA_STATUS, PARADA_TIPOS, ROTA_STATUS } from "@/lib/constants";
import { brl, date, num, time } from "@/lib/format";
import { linkTrajeto } from "@/lib/integracoes/maps";
import type { CheckinRota, DespesaRota, Rota, RotaParada, RotaResumo } from "@/lib/types";
import {
  adicionarClientesFiltro, adicionarParada, aprovarDespesaRapida, aprovarRota, cancelarRota, otimizarRota, reagendarParadas, removerParada, revisarCheckin, salvarRota,
} from "@/lib/actions/rotas";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionButton } from "@/components/ui/action-button";
import { LinkButton } from "@/components/ui/button";

export const metadata: Metadata = { title: "Rota" };

const horas = (min: number | null | undefined) => (min == null ? "—" : `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, "0")}`);

export default async function RotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { profile, userId } = await requireSession();
  if (!can(profile, "rotas.ver") && !can(profile, "rotas.executar") && !can(profile, "rotas.definir")) redirect("/inicio?erro=permissao");
  const supabase = await createClient();
  const { data: rota } = await supabase.from("rotas").select("*").eq("id", id).maybeSingle<Rota>();
  if (!rota) notFound();
  const [{ data: pRows }, { data: cRows }, { data: dRows }, { data: resumoAtual }, profiles, clientes, consultores, { data: veiculos }, { data: planejadas }] = await Promise.all([
    supabase.from("rota_paradas").select("*").eq("rota_id", id).order("ordem"),
    supabase.from("checkins").select("*").eq("rota_id", id).order("registrado_em"),
    supabase.from("despesas_rota").select("*").eq("rota_id", id).order("created_at"),
    supabase.rpc("resumo_da_rota", { p_rota: id }),
    getProfileMap(),
    can(profile, "rotas.definir") ? clienteOptions() : Promise.resolve([]),
    can(profile, "rotas.definir") ? consultorOptions() : Promise.resolve([]),
    supabase.from("veiculos").select("id, descricao, placa").eq("ativo", true),
    supabase.from("rotas").select("id, nome, data").eq("status", "planejada").neq("id", id).order("data").limit(50),
  ]);
  const paradas = (pRows ?? []) as RotaParada[];
  const checkins = (cRows ?? []) as CheckinRota[];
  const despesas = (dRows ?? []) as DespesaRota[];
  const resumo = (resumoAtual ?? rota.resumo) as RotaResumo | null;
  const planeja = can(profile, "rotas.definir");
  const aprova = can(profile, "rotas.aprovar");
  const editavel = planeja && (rota.status === "planejada" || rota.status === "em_andamento");
  const meu = rota.consultor_id === userId;
  const tituloParada = new Map(paradas.map((p) => [p.id, `${p.ordem}. ${p.titulo}`]));
  const pontos = paradas.filter((p) => p.lat != null && p.lng != null).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  const trajeto = linkTrajeto(rota.inicio_lat != null ? [{ lat: Number(rota.inicio_lat), lng: Number(rota.inicio_lng) }, ...pontos] : pontos);
  const caminhos = [...checkins.map((c) => c.foto_path), ...despesas.map((d) => d.comprovante_path), rota.hodometro_foto_inicio, rota.hodometro_foto_fim].filter((x): x is string => !!x);
  const { data: urls } = caminhos.length ? await supabase.storage.from("documentos").createSignedUrls(caminhos, 600) : { data: [] };
  const urlDe = new Map((urls ?? []).filter((u) => u.signedUrl).map((u) => [u.path ?? "", u.signedUrl as string]));
  const fotoHodIni = rota.hodometro_foto_inicio ? urlDe.get(rota.hodometro_foto_inicio) : undefined;
  const fotoHodFim = rota.hodometro_foto_fim ? urlDe.get(rota.hodometro_foto_fim) : undefined;
  const opVeic = (veiculos ?? []).map((v) => ({ value: v.id, label: v.placa ? `${v.descricao} · ${v.placa}` : v.descricao }));
  const naoRealizadas = paradas.filter((p) => p.status === "nao_realizada" || (p.status === "pendente" && rota.status !== "planejada"));

  return (
    <>
      <Link href="/rotas" className="no-print mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Rotas</Link>
      <PageHeader
        eyebrow={`${date(rota.data)} · ${profiles.get(rota.consultor_id)?.full_name ?? "Consultor"}`}
        title={<span className="flex flex-wrap items-center gap-3">{rota.nome}<StatusBadge options={ROTA_STATUS} value={rota.status} /></span>}
        description={rota.objetivo ?? undefined}
        actions={
          <>
            {meu && (rota.status === "planejada" || rota.status === "em_andamento") && <LinkButton href={`/campo/rota/${rota.id}`} variant="accent"><Smartphone className="h-4 w-4" />Executar no app</LinkButton>}
            {trajeto && <LinkButton href={trajeto} variant="secondary" target="_blank" rel="noopener noreferrer"><Navigation className="h-4 w-4" />Trajeto no Maps</LinkButton>}
            {editavel && rota.status === "planejada" && <ActionButton action={otimizarRota.bind(null, rota.id)} label="Otimizar ordem" icon={<Route className="h-4 w-4" />} size="md" />}
            {editavel && (
              <FormDrawerButton action={salvarRota} hidden={{ id: rota.id }} title="Editar rota" icon="edit" size="icon" variant="ghost" width="max-w-lg"
                values={{ nome: rota.nome, data: rota.data, consultor_id: rota.consultor_id, veiculo_id: rota.veiculo_id, objetivo: rota.objetivo }}
                fields={[
                  { name: "nome", label: "Nome", required: true, span: 6 },
                  { name: "data", label: "Data", type: "date", required: true, span: 3 },
                  { name: "consultor_id", label: "Consultor", type: "select", options: consultores, required: true, span: 3 },
                  { name: "veiculo_id", label: "Veículo", type: "select", options: opVeic, span: 6 },
                  { name: "objetivo", label: "Objetivo", type: "textarea", rows: 3, span: 6 },
                ]} />
            )}
            {planeja && rota.status === "planejada" && <ConfirmAction action={cancelarRota} id={rota.id} title="Cancelar rota?" message="A rota sai do app do consultor. As paradas ficam no histórico." confirmLabel="Cancelar rota" label="Cancelar" size="sm" variant="ghost" />}
            {aprova && rota.status === "concluida" && !meu && <ActionButton action={aprovarRota.bind(null, rota.id)} label="Aprovar rota" variant="primary" size="md" icon={<Check className="h-4 w-4" />} />}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Km planejado / realizado" value={`${rota.km_planejado != null ? num(rota.km_planejado) : "—"} / ${resumo ? num(resumo.km) : "—"}`} hint={resumo ? `Método: ${resumo.metodo_km === "hodometro" ? "hodômetro" : "linha reta × fator"}` : undefined} icon={<Gauge className="h-5 w-5" />} />
        <StatCard label="Locomoção / em visita" value={`${horas(resumo?.tempo_locomocao_min)} / ${horas(resumo?.tempo_visita_min)}`} hint={rota.tempo_planejado_min ? `Planejado: ${horas(rota.tempo_planejado_min)}` : undefined} icon={<Clock className="h-5 w-5" />} tone="accent" />
        <StatCard label="Custo da rota" value={resumo ? brl(resumo.custo_total) : "—"} hint={resumo ? `km ${brl(resumo.custo_km)} + despesas ${brl(resumo.despesas_aprovadas)}` : undefined} icon={<Wallet className="h-5 w-5" />} tone="green" />
        <StatCard label="Custo por cliente" value={resumo?.custo_por_visitado != null ? brl(resumo.custo_por_visitado) : "—"} hint={`Adquiridos: ${resumo?.adquiridos ?? 0}${resumo?.custo_por_adquirido != null ? ` · ${brl(resumo.custo_por_adquirido)} cada` : ""}`} icon={<MapPin className="h-5 w-5" />} />
      </div>
      {resumo && (resumo.fora_do_raio > 0 || resumo.inconsistencias > 0) && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4" /> {resumo.fora_do_raio} check-in(s) fora do raio e {resumo.inconsistencias} com sinal de inconsistência — revise abaixo.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title={`Paradas (${paradas.length})`}
            icon={<MapPin className="h-4 w-4" />}
            action={editavel && (
              <div className="flex gap-2">
                <FormDrawerButton action={adicionarClientesFiltro} hidden={{ rota_id: rota.id }} title="Incluir clientes por filtro" label="Por filtro" size="sm" variant="secondary" icon="none" width="max-w-lg"
                  description="Ex.: todos os clientes com documentação pendente numa cidade."
                  values={{ status_cadastro: "pendente_documentacao", limite: 30 }}
                  fields={[
                    { name: "cidade", label: "Cidade", span: 6 },
                    { name: "status_cadastro", label: "Situação do cadastro", type: "select", options: CADASTRO_STATUS, span: 3 },
                    { name: "carteira", label: "Carteira", type: "select", options: CARTEIRAS, span: 3 },
                    { name: "consultor_id", label: "Consultor dono", type: "select", options: consultores, span: 4 },
                    { name: "limite", label: "Máximo", type: "number", min: 1, max: 100, span: 2 },
                  ]} />
                <FormDrawerButton action={adicionarParada} hidden={{ rota_id: rota.id }} title="Nova parada" label="Parada" size="sm" variant="accent" width="max-w-lg"
                  description="Com cliente, o endereço e a localização vêm do cadastro. Sem coordenadas, o sistema localiza pelo endereço."
                  values={{ tipo: "cliente", obrigatoria: true }}
                  fields={[
                    { name: "tipo", label: "Tipo", type: "select", options: PARADA_TIPOS, emptyOption: false, span: 3 },
                    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, span: 3 },
                    { name: "titulo", label: "Título (se não for cliente)", span: 6 },
                    { name: "endereco", label: "Endereço", span: 6 },
                    { name: "cidade", label: "Cidade", span: 4 },
                    { name: "uf", label: "UF", span: 2 },
                    { name: "lat", label: "Latitude", type: "number", step: "any", span: 3 },
                    { name: "lng", label: "Longitude", type: "number", step: "any", span: 3 },
                    { name: "raio_m", label: "Raio (m)", type: "number", min: 20, max: 5000, span: 2, help: "Vazio = padrão da empresa" },
                    { name: "janela_inicio", label: "Janela de", type: "time", span: 2 },
                    { name: "janela_fim", label: "até", type: "time", span: 2 },
                    { name: "objetivo", label: "Objetivo da visita", type: "textarea", rows: 2, span: 6 },
                    { name: "obrigatoria", label: "Visita obrigatória", type: "checkbox", span: 6 },
                  ]} />
              </div>
            )}
          />
          {paradas.length === 0 ? <EmptyState title="Nenhuma parada" description={editavel ? "Inclua clientes, cidades ou endereços." : undefined} /> : (
            <ul className="divide-y divide-line">
              {paradas.map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-5 py-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{p.ordem}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {p.cliente_id ? <Link href={`/clientes/${p.cliente_id}`} className="font-medium hover:text-brand-600">{p.titulo}</Link> : <span className="font-medium">{p.titulo}</span>}
                      <StatusBadge options={PARADA_STATUS} value={p.status} />
                      {!p.obrigatoria && <Badge tone="slate">opcional</Badge>}
                      {p.lat == null && <Badge tone="amber">sem coordenadas</Badge>}
                    </div>
                    <p className="text-xs text-muted">{optionLabel(PARADA_TIPOS, p.tipo)}{p.endereco ? ` · ${p.endereco}` : ""}{p.cidade ? ` · ${p.cidade}${p.uf ? `/${p.uf}` : ""}` : ""}{p.janela_inicio ? ` · ${p.janela_inicio.slice(0, 5)}–${p.janela_fim?.slice(0, 5) ?? ""}` : ""}</p>
                    {p.objetivo && <p className="text-xs">{p.objetivo}</p>}
                    {p.motivo && <p className="text-xs text-red-600">Motivo: {p.motivo}</p>}
                  </div>
                  {editavel && p.status === "pendente" && rota.status === "planejada" && <ConfirmAction action={removerParada} id={p.id} title="Remover parada?" message="A parada sai da rota." confirmLabel="Remover" />}
                </li>
              ))}
            </ul>
          )}
          {planeja && naoRealizadas.length > 0 && (planejadas ?? []).length > 0 && (
            <CardBody className="border-t border-line">
              <FormDrawerButton action={reagendarParadas} title="Reagendar paradas" label={`Reagendar ${naoRealizadas.length} parada(s) não realizada(s)`} size="sm" variant="outline" icon="none" width="max-w-lg"
                values={{ paradas: naoRealizadas.map((p) => p.id) }}
                fields={[
                  { name: "paradas", label: "Paradas", type: "multiselect", options: naoRealizadas.map((p) => ({ value: p.id, label: `${p.ordem}. ${p.titulo}` })), span: 6 },
                  { name: "rota_destino", label: "Para a rota", type: "select", options: (planejadas ?? []).map((r) => ({ value: r.id, label: `${date(r.data)} · ${r.nome}` })), required: true, span: 6 },
                ]} />
            </CardBody>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title={`Check-ins (${checkins.length})`}
              description={rota.iniciada_em ? `Início ${time(rota.iniciada_em)}${rota.finalizada_em ? ` · fim ${time(rota.finalizada_em)}` : ""}` : "A rota ainda não foi iniciada."}
              icon={<Navigation className="h-4 w-4" />}
              action={
                (fotoHodIni || fotoHodFim) && (
                  <span className="text-xs text-muted">
                    Hodômetro: {fotoHodIni && <a href={fotoHodIni} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">foto do início</a>}
                    {fotoHodIni && fotoHodFim && " · "}
                    {fotoHodFim && <a href={fotoHodFim} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">foto do fim</a>}
                  </span>
                )
              }
            />
            {checkins.length === 0 ? <EmptyState title="Sem check-ins" /> : (
              <ul className="divide-y divide-line">
                {checkins.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{time(c.registrado_em)}</span>
                      <Badge tone={c.tipo === "chegada" ? "brand" : "slate"}>{c.tipo === "chegada" ? "Chegada" : "Saída"}</Badge>
                      <span className="font-medium">{c.parada_id ? (tituloParada.get(c.parada_id) ?? "Parada") : "—"}</span>
                      {c.resultado && <StatusBadge options={CHECKIN_RESULTADOS} value={c.resultado} />}
                      {c.dentro_do_raio === false && <Badge tone="red">fora do raio · {c.distancia_m} m</Badge>}
                      {c.dentro_do_raio === true && <Badge tone="green">no raio · {c.distancia_m} m</Badge>}
                      {c.flags.map((f) => <Badge key={f} tone="amber">{CHECKIN_FLAGS[f] ?? f}</Badge>)}
                    </div>
                    {c.justificativa && <p className="mt-1 text-xs">Justificativa: {c.justificativa}</p>}
                    {c.observacao && <p className="mt-1 text-xs text-muted">{c.observacao}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                      <a href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">ver no mapa</a>
                      {c.precisao != null && <span>precisão {Math.round(c.precisao)} m</span>}
                      {c.foto_path && urlDe.get(c.foto_path) && <a href={urlDe.get(c.foto_path)} target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">foto</a>}
                      {c.revisao === "pendente" && <Badge tone="amber">aguardando revisão</Badge>}
                      {c.revisao === "aprovado" && <Badge tone="green">revisado: aceito</Badge>}
                      {c.revisao === "rejeitado" && <Badge tone="red">revisado: rejeitado</Badge>}
                    </div>
                    {aprova && c.revisao === "pendente" && c.consultor_id !== userId && (
                      <div className="mt-2 flex gap-2">
                        <ActionButton action={revisarCheckin.bind(null, c.id, true)} label="Aceitar" icon={<Check className="h-3.5 w-3.5" />} />
                        <ActionButton action={revisarCheckin.bind(null, c.id, false)} label="Rejeitar" variant="ghost" icon={<X className="h-3.5 w-3.5" />} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={`Despesas (${despesas.length})`} icon={<Receipt className="h-4 w-4" />} action={<Link href="/rotas/despesas" className="text-sm font-semibold text-brand-600">Todas</Link>} />
            {despesas.length === 0 ? <EmptyState title="Sem despesas" /> : (
              <ul className="divide-y divide-line">
                {despesas.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span><b>{brl(d.valor)}</b> · {optionLabel(DESPESA_TIPOS, d.tipo)} · {date(d.data)}{d.comprovante_path && urlDe.get(d.comprovante_path) && <> · <a href={urlDe.get(d.comprovante_path)} target="_blank" rel="noopener noreferrer" className="text-brand-600">comprovante</a></>}</span>
                    <span className="flex items-center gap-2"><StatusBadge options={DESPESA_STATUS} value={d.status} />{can(profile, "despesas.aprovar") && d.status === "lancada" && d.consultor_id !== userId && <ActionButton action={aprovarDespesaRapida.bind(null, d.id)} label="Aprovar" />}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
