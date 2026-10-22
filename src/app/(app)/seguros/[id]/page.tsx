import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, User, BadgeDollarSign, Receipt, Wallet, CreditCard, CalendarRange, History, ArrowRight, Siren } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap, parceiroMap, parceiroOptions, produtoOptions } from "@/lib/data";
import { APOLICE_STATUS, COMISSAO_STATUS, RAMOS_SEGURO, SINISTRO_STATUS } from "@/lib/constants";
import { brl, date, daysUntil, pct, todayISO } from "@/lib/format";
import type { Comissao, SeguroApolice, SeguroSinistro } from "@/lib/types";
import { createSinistro, deleteApolice, deleteSinistro, updateApolice, updateSinistro } from "@/lib/actions/seguros";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { apoliceFields, sinistroFields, vencimentoLabel, vencimentoTone } from "@/components/seguros/fields";
import { RenovarButton } from "@/components/seguros/renovar-button";

export const metadata: Metadata = { title: "Apólice" };

type ApoliceDetail = SeguroApolice & { clientes: { id: string; nome: string } | null };
type Link_ = Pick<SeguroApolice, "id" | "numero_apolice" | "numero_proposta" | "inicio_vigencia" | "fim_vigencia" | "status">;

const apoliceRef = (a: Pick<SeguroApolice, "numero_apolice" | "numero_proposta">) =>
  a.numero_apolice ? `Apólice ${a.numero_apolice}` : a.numero_proposta ? `Proposta ${a.numero_proposta}` : "Sem número";

export default async function ApolicePage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requirePermission("clientes.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: row } = await supabase.from("seguro_apolices").select("*, clientes(id, nome)").eq("id", id).maybeSingle<ApoliceDetail>();
  if (!row) notFound();
  const { clientes: cliente, ...apolice } = row;

  const linkCols = "id, numero_apolice, numero_proposta, inicio_vigencia, fim_vigencia, status";
  const [{ data: sinistrosData }, { data: anterior }, { data: proximas }, { data: comissao }, { data: produto }, parceiros, profiles] = await Promise.all([
    supabase.from("seguro_sinistros").select("*").eq("apolice_id", id).order("data_ocorrencia", { ascending: false }),
    apolice.renovacao_de ? supabase.from("seguro_apolices").select(linkCols).eq("id", apolice.renovacao_de).maybeSingle<Link_>() : Promise.resolve({ data: null }),
    supabase.from("seguro_apolices").select(linkCols).eq("renovacao_de", id).order("created_at", { ascending: false }).limit(1),
    supabase.from("comissoes").select("valor_corretora, valor_consultor, status").eq("apolice_id", id).maybeSingle<Pick<Comissao, "valor_corretora" | "valor_consultor" | "status">>(),
    apolice.produto_id ? supabase.from("produtos").select("nome").eq("id", apolice.produto_id).maybeSingle<{ nome: string }>() : Promise.resolve({ data: null }),
    parceiroMap(),
    getProfileMap(),
  ]);
  const sinistros = (sinistrosData ?? []) as SeguroSinistro[];
  const proxima = ((proximas ?? []) as Link_[])[0] ?? null;

  const canWrite = can(profile, "negocios.write");
  const canDelete = can(profile, "negocios.delete");
  const canTransfer = can(profile, "clientes.transfer");
  const [clientes, seguradoras, produtos, consultores] = canWrite
    ? await Promise.all([clienteOptions(), parceiroOptions("seguradora"), produtoOptions("seguro"), canTransfer ? consultorOptions() : Promise.resolve([])])
    : [[], [], [], []];

  const hoje = todayISO();
  const inicioMs = new Date(apolice.inicio_vigencia + "T00:00:00Z").getTime();
  const fimMs = new Date(apolice.fim_vigencia + "T00:00:00Z").getTime();
  const hojeMs = new Date(hoje + "T00:00:00Z").getTime();
  const totalDias = Math.max(1, Math.round((fimMs - inicioMs) / 86400000));
  const decorrido = Math.max(0, Math.min(100, ((hojeMs - inicioMs) / (fimMs - inicioMs || 1)) * 100));
  const dias = daysUntil(apolice.fim_vigencia);
  const naoIniciada = hoje < apolice.inicio_vigencia;
  const seguradora = apolice.seguradora_id ? parceiros.get(apolice.seguradora_id) : null;
  const consultor = apolice.consultor_id ? profiles.get(apolice.consultor_id) : null;
  const comissaoPrevista = (Number(apolice.premio_liquido) * Number(apolice.comissao_percentual)) / 100;
  const parcelaValor = Number(apolice.premio_total) / Math.max(1, apolice.parcelas);
  const podeRenovar = canWrite && !proxima && (apolice.status === "vigente" || apolice.status === "vencida");
  const indenizado = sinistros.filter((s) => s.status === "pago" || s.status === "aprovado").reduce((a, s) => a + Number(s.valor_indenizacao ?? 0), 0);
  const titulo = apoliceRef(apolice);

  return (
    <>
      <Link href="/seguros" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Seguros
      </Link>

      <Card className="mb-6 overflow-hidden">
        <div className="brand-gradient h-20" />
        <div className="-mt-9 flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:items-end">
          <div className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-700/30 ring-4 ring-surface">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
              <StatusBadge options={APOLICE_STATUS} value={apolice.status} />
              <Badge tone="accent">{optionLabel(RAMOS_SEGURO, apolice.ramo)}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {cliente && (
                <Link href={`/clientes/${cliente.id}`} className="flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-200">
                  <User className="h-3.5 w-3.5" />
                  {cliente.nome}
                </Link>
              )}
              {seguradora && <span>{seguradora}</span>}
              {apolice.item_segurado && <span className="truncate">{apolice.item_segurado}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {podeRenovar && <RenovarButton id={id} fimVigencia={date(apolice.fim_vigencia)} />}
            {canWrite && (
              <FormDrawerButton
                action={updateApolice}
                fields={apoliceFields({ clientes, seguradoras, produtos, consultores, canTransfer, edit: true })}
                values={{ ...apolice }}
                hidden={{ id }}
                title="Editar seguro"
                label="Editar"
                icon="edit"
                variant="secondary"
              />
            )}
            {canDelete && <ConfirmAction action={deleteApolice} id={id} title="Excluir apólice?" message="A apólice, seus sinistros e a comissão vinculada serão removidos definitivamente." redirectTo="/seguros" variant="secondary" />}
          </div>
        </div>
        <div className="grid grid-cols-1 border-t border-line sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<BadgeDollarSign className="h-5 w-5" />} label="Prêmio total" value={brl(apolice.premio_total)} hint="com IOF e encargos" />
          <Kpi icon={<Receipt className="h-5 w-5" />} label="Prêmio líquido" value={brl(apolice.premio_liquido)} />
          <Kpi icon={<Wallet className="h-5 w-5" />} label="Comissão da corretora" value={brl(comissao?.valor_corretora ?? comissaoPrevista)} hint={`${pct(apolice.comissao_percentual, 2)} do prêmio líquido`} />
          <Kpi icon={<CreditCard className="h-5 w-5" />} label="Pagamento" value={`${apolice.parcelas}× ${brl(parcelaValor)}`} hint={apolice.forma_pagamento ?? "Forma não informada"} last />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Vigência" icon={<CalendarRange className="h-4 w-4" />} description={`${totalDias} dias de cobertura`} />
            <CardBody>
              <div className="flex items-end justify-between text-sm">
                <div>
                  <p className="text-xs text-muted">Início</p>
                  <p className="font-semibold">{date(apolice.inicio_vigencia)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">Fim</p>
                  <p className="font-semibold">{date(apolice.fim_vigencia)}</p>
                </div>
              </div>
              <Progress value={decorrido} className="mt-3 h-2.5" tone={dias <= 30 && apolice.status === "vigente" ? "accent" : "brand"} />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>{naoIniciada ? "Ainda não iniciada" : `${Math.round(decorrido)}% do período decorrido`}</span>
                {apolice.status === "vigente" || apolice.status === "vencida" ? (
                  <Badge tone={dias < 0 ? "red" : vencimentoTone(dias)}>{vencimentoLabel(dias)}</Badge>
                ) : null}
              </div>

              {(anterior || proxima) && (
                <div className="mt-5 space-y-2 border-t border-line pt-4">
                  {anterior && <RenewalLink href={`/seguros/${anterior.id}`} label="Renovação de" a={anterior} icon={<History className="h-4 w-4" />} />}
                  {proxima && <RenewalLink href={`/seguros/${proxima.id}`} label="Renovada para" a={proxima} icon={<ArrowRight className="h-4 w-4" />} />}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Dados do seguro" />
            <CardBody className="space-y-4 text-sm">
              {(
                [
                  ["Seguradora", seguradora],
                  ["Produto", produto?.nome],
                  ["Ramo", optionLabel(RAMOS_SEGURO, apolice.ramo)],
                  ["Nº da apólice", apolice.numero_apolice],
                  ["Nº da proposta", apolice.numero_proposta],
                  ["Item segurado", apolice.item_segurado],
                  ["Forma de pagamento", apolice.forma_pagamento],
                  ["Consultor", consultor?.full_name],
                ] as [string, string | null | undefined][]
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                  <span className="shrink-0 text-muted">{label}</span>
                  <span className="text-right font-medium">{value || "—"}</span>
                </div>
              ))}
              {comissao && (
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted">Comissão lançada</p>
                    <StatusBadge options={COMISSAO_STATUS} value={comissao.status} />
                  </div>
                  <p className="mt-1 text-lg font-bold">{brl(comissao.valor_corretora)}</p>
                  <p className="text-xs text-muted">Consultor: {brl(comissao.valor_consultor)}</p>
                </div>
              )}
              {apolice.observacoes && (
                <div className="rounded-xl bg-surface-2 p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold text-muted">Observações</p>
                  <p className="whitespace-pre-wrap">{apolice.observacoes}</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader
            title="Sinistros"
            icon={<Siren className="h-4 w-4" />}
            description={sinistros.length ? `${sinistros.length} registro(s) · ${brl(indenizado)} em indenizações aprovadas/pagas` : "Avisos de sinistro e acompanhamento das indenizações"}
            action={
              canWrite && (
                <FormDrawerButton action={createSinistro} fields={sinistroFields} hidden={{ apolice_id: id }} values={{ data_ocorrencia: todayISO(), status: "aberto" }} title="Registrar sinistro" description={titulo} label="Novo sinistro" size="sm" width="max-w-lg" />
              )
            }
          />
          {sinistros.length === 0 ? (
            <EmptyState icon={<Siren className="h-6 w-6" />} title="Nenhum sinistro registrado" description="Quando o cliente acionar o seguro, registre aqui o aviso e acompanhe o status." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Ocorrência</th>
                    <th>Descrição</th>
                    <th className="text-right">Indenização</th>
                    <th>Status</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {sinistros.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="font-medium">{date(s.data_ocorrencia)}</span>
                        {s.numero_sinistro && <div className="text-xs text-muted">Nº {s.numero_sinistro}</div>}
                      </td>
                      <td>
                        <p className="line-clamp-2 max-w-[360px] text-sm" title={s.descricao}>
                          {s.descricao}
                        </p>
                      </td>
                      <td className="text-right tabular-nums">{s.valor_indenizacao !== null ? brl(s.valor_indenizacao) : <span className="text-muted">—</span>}</td>
                      <td>
                        <StatusBadge options={SINISTRO_STATUS} value={s.status} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {canWrite && (
                            <FormDrawerButton action={updateSinistro} fields={sinistroFields} hidden={{ id: s.id, apolice_id: id }} values={{ ...s }} title="Editar sinistro" description={titulo} icon="edit" variant="ghost" size="icon" width="max-w-lg" />
                          )}
                          {canDelete && <ConfirmAction action={deleteSinistro} id={s.id} title="Remover sinistro?" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Kpi({ icon, label, value, hint, last }: { icon: React.ReactNode; label: string; value: string; hint?: string; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3 border-b border-line px-6 py-4 sm:border-b-0 ${last ? "" : "sm:border-r"}`}>
      <span className="text-accent-500">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="font-semibold">{value}</p>
        {hint && <p className="truncate text-[11px] text-muted">{hint}</p>}
      </div>
    </div>
  );
}

function RenewalLink({ href, label, a, icon }: { href: string; label: string; a: Link_; icon: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-muted">{label}</span>
        <span className="block truncate text-sm font-medium">{apoliceRef(a)}</span>
        <span className="block text-[11px] text-muted">
          {date(a.inicio_vigencia)} → {date(a.fim_vigencia)}
        </span>
      </span>
      <StatusBadge options={APOLICE_STATUS} value={a.status} />
    </Link>
  );
}
