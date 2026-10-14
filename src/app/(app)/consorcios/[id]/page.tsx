import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Landmark, Wallet, CalendarClock, Hourglass, Gavel, Trophy, User, Calculator, CircleDollarSign } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap, parceiroMap, parceiroOptions, produtoOptions } from "@/lib/data";
import { CATEGORIAS_CONSORCIO, COMISSAO_STATUS, CONTEMPLACAO, COTA_STATUS, LANCE_RESULTADO } from "@/lib/constants";
import { brl, date, pct, todayISO } from "@/lib/format";
import type { Comissao, ConsorcioCota, ConsorcioLance } from "@/lib/types";
import { createLance, deleteCota, deleteLance, updateCota, updateLance } from "@/lib/actions/consorcios";
import { Badge, StatusBadge, optionLabel } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { cotaFields, lanceFields } from "@/components/consorcios/fields";
import { LanceResultadoSelect } from "@/components/consorcios/lance-resultado-select";

export const metadata: Metadata = { title: "Cota de consórcio" };

type CotaDetail = ConsorcioCota & { clientes: { id: string; nome: string; documento: string | null } | null };

export default async function CotaPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requirePermission("clientes.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();

  const { data: row } = await supabase.from("consorcio_cotas").select("*, clientes(id, nome, documento)").eq("id", id).maybeSingle<CotaDetail>();
  if (!row) notFound();
  const { clientes: cliente, ...cota } = row;

  const [{ data: lancesData }, { data: comissao }, { data: produto }, parceiros, profiles] = await Promise.all([
    supabase.from("consorcio_lances").select("*").eq("cota_id", id).order("data_assembleia", { ascending: false }),
    supabase.from("comissoes").select("valor_corretora, valor_consultor, status, percentual_corretora").eq("cota_id", id).maybeSingle<Pick<Comissao, "valor_corretora" | "valor_consultor" | "status" | "percentual_corretora">>(),
    cota.produto_id ? supabase.from("produtos").select("nome").eq("id", cota.produto_id).maybeSingle<{ nome: string }>() : Promise.resolve({ data: null }),
    parceiroMap(),
    getProfileMap(),
  ]);
  const lances = (lancesData ?? []) as ConsorcioLance[];

  const canWrite = can(profile.role, "negocios.write");
  const canDelete = can(profile.role, "negocios.delete");
  const canTransfer = can(profile.role, "clientes.transfer");
  const [clientes, administradoras, produtos, consultores] = canWrite
    ? await Promise.all([clienteOptions(), parceiroOptions("administradora"), produtoOptions("consorcio"), canTransfer ? consultorOptions() : Promise.resolve([])])
    : [[], [], [], []];

  const credito = Number(cota.valor_credito);
  const parcela = Number(cota.parcela_valor);
  const restantes = Math.max(0, cota.prazo_meses - cota.parcelas_pagas);
  const saldo = restantes * parcela;
  const pctPago = cota.prazo_meses ? (cota.parcelas_pagas / cota.prazo_meses) * 100 : 0;
  const administradora = cota.administradora_id ? parceiros.get(cota.administradora_id) : null;
  const consultor = cota.consultor_id ? profiles.get(cota.consultor_id) : null;
  const contemplada = cota.status === "contemplada" || Boolean(cota.contemplada_em);
  const valorLance = Number(cota.valor_lance ?? 0);
  const creditoLiquido = cota.forma_contemplacao === "lance_embutido" ? credito - valorLance : credito;
  const lanceValor = (l: ConsorcioLance) => (l.valor !== null ? Number(l.valor) : l.percentual !== null ? (credito * Number(l.percentual)) / 100 : null);
  const maiorLance = lances.reduce((m, l) => Math.max(m, l.percentual !== null ? Number(l.percentual) : l.valor !== null ? (Number(l.valor) / credito) * 100 : 0), 0);
  const titulo = `Grupo ${cota.grupo ?? "—"} · Cota ${cota.cota ?? "—"}`;
  const podeLance = canWrite && cota.status !== "cancelada" && cota.status !== "quitada";

  return (
    <>
      <Link href="/consorcios" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Consórcios
      </Link>

      <Card className="mb-6 overflow-hidden">
        <div className="brand-gradient h-20" />
        <div className="-mt-9 flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:items-end">
          <div className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-lg shadow-accent-600/30 ring-4 ring-surface">
            <Landmark className="h-8 w-8" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
              <StatusBadge options={COTA_STATUS} value={cota.status} />
              <Badge tone="brand">{optionLabel(CATEGORIAS_CONSORCIO, cota.categoria)}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              {cliente && (
                <Link href={`/clientes/${cliente.id}`} className="flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-200">
                  <User className="h-3.5 w-3.5" />
                  {cliente.nome}
                </Link>
              )}
              {administradora && <span>{administradora}</span>}
              {cota.numero_contrato && <span>Contrato {cota.numero_contrato}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/consorcios/simulador?${new URLSearchParams({ credito: String(credito), prazo: String(cota.prazo_meses), taxa: String(cota.taxa_adm), fundo: String(cota.fundo_reserva), ...(cliente ? { cliente: cliente.nome } : {}) })}`} variant="secondary" aria-label="Simular com os dados desta cota" title="Simular com os dados desta cota">
              <Calculator className="h-4 w-4" />
            </LinkButton>
            {canWrite && (
              <FormDrawerButton
                action={updateCota}
                fields={cotaFields({ clientes, administradoras, produtos, consultores, canTransfer, edit: true })}
                values={{ ...cota }}
                hidden={{ id }}
                title="Editar cota"
                label="Editar"
                icon="edit"
                variant="secondary"
              />
            )}
            {canDelete && <ConfirmAction action={deleteCota} id={id} title="Excluir cota?" message="A cota, seus lances e a comissão vinculada serão removidos definitivamente." redirectTo="/consorcios" variant="secondary" />}
          </div>
        </div>
        <div className="grid grid-cols-1 border-t border-line sm:grid-cols-2 xl:grid-cols-4">
          <Kpi icon={<Wallet className="h-5 w-5" />} label="Crédito contratado" value={brl(credito)} hint={`Taxa adm. ${pct(cota.taxa_adm, 2)} · F. reserva ${pct(cota.fundo_reserva, 2)}`} />
          <Kpi icon={<CalendarClock className="h-5 w-5" />} label="Parcela mensal" value={brl(parcela)} hint={cota.dia_vencimento ? `Vence todo dia ${cota.dia_vencimento}` : "Vencimento não informado"} />
          <div className="border-b border-line px-6 py-4 sm:border-b-0 sm:border-r">
            <div className="flex items-center gap-3">
              <Hourglass className="h-5 w-5 text-accent-500" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">Parcelas pagas</p>
                <p className="font-semibold">
                  {cota.parcelas_pagas} de {cota.prazo_meses} <span className="text-xs font-normal text-muted">({Math.round(pctPago)}%)</span>
                </p>
              </div>
            </div>
            <Progress value={pctPago} className="mt-2.5" tone={contemplada ? "green" : "accent"} />
          </div>
          <Kpi icon={<CircleDollarSign className="h-5 w-5" />} label="Saldo devedor estimado" value={brl(saldo)} hint={`${restantes} parcela(s) restante(s)`} last />
        </div>
      </Card>

      {contemplada && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-surface dark:border-emerald-900 dark:from-emerald-950/40">
          <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-600/30">
              <Trophy className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">Cota contemplada{cota.contemplada_em ? ` em ${date(cota.contemplada_em)}` : ""}</p>
              <p className="text-sm text-muted">
                {cota.forma_contemplacao ? `Por ${optionLabel(CONTEMPLACAO, cota.forma_contemplacao).toLowerCase()}` : "Forma de contemplação não informada"}
                {valorLance > 0 && ` · lance de ${brl(valorLance)} (${pct((valorLance / credito) * 100, 2)} do crédito)`}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs text-muted">Crédito disponível estimado</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{brl(creditoLiquido)}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader title="Dados da cota" />
          <CardBody className="space-y-4 text-sm">
            {(
              [
                ["Administradora", administradora],
                ["Produto / plano", produto?.nome],
                ["Categoria", optionLabel(CATEGORIAS_CONSORCIO, cota.categoria)],
                ["Grupo / cota", `${cota.grupo ?? "—"} / ${cota.cota ?? "—"}`],
                ["Nº do contrato", cota.numero_contrato],
                ["Prazo", `${cota.prazo_meses} meses`],
                ["Taxa de administração", pct(cota.taxa_adm, 3)],
                ["Fundo de reserva", pct(cota.fundo_reserva, 3)],
                ["Data de adesão", date(cota.data_adesao)],
                ["Dia de vencimento", cota.dia_vencimento ? `Dia ${cota.dia_vencimento}` : null],
                ["Consultor", consultor?.full_name],
              ] as [string, string | null | undefined][]
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
                <span className="text-muted">{label}</span>
                <span className="text-right font-medium">{value || "—"}</span>
              </div>
            ))}
            {comissao && (
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-muted">Comissão da corretora</p>
                  <StatusBadge options={COMISSAO_STATUS} value={comissao.status} />
                </div>
                <p className="mt-1 text-lg font-bold">{brl(comissao.valor_corretora)}</p>
                <p className="text-xs text-muted">
                  {pct(comissao.percentual_corretora, 2)} do crédito · consultor {brl(comissao.valor_consultor)}
                </p>
              </div>
            )}
            {cota.observacoes && (
              <div className="rounded-xl bg-surface-2 p-3 text-sm">
                <p className="mb-1 text-xs font-semibold text-muted">Observações</p>
                <p className="whitespace-pre-wrap">{cota.observacoes}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lances e assembleias"
            icon={<Gavel className="h-4 w-4" />}
            description={lances.length ? `${lances.length} lance(s) registrado(s) · maior lance ${pct(maiorLance, 2)} do crédito` : "Registre os lances ofertados em cada assembleia"}
            action={
              podeLance && (
                <FormDrawerButton
                  action={createLance}
                  fields={lanceFields}
                  hidden={{ cota_id: id }}
                  values={{ data_assembleia: todayISO(), tipo: "lance_livre", resultado: "pendente" }}
                  title="Registrar lance"
                  description={titulo}
                  label="Registrar lance"
                  size="sm"
                  width="max-w-lg"
                />
              )
            }
          />
          {lances.length === 0 ? (
            <EmptyState icon={<Gavel className="h-6 w-6" />} title="Nenhum lance registrado" description="Acompanhe aqui as assembleias, lances ofertados e o resultado de cada uma." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Assembleia</th>
                    <th>Tipo</th>
                    <th className="text-right">Lance</th>
                    <th>Resultado</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody>
                  {lances.map((l) => {
                    const v = lanceValor(l);
                    return (
                      <tr key={l.id}>
                        <td>
                          <span className="font-medium">{date(l.data_assembleia)}</span>
                          {l.observacoes && <p className="max-w-[260px] truncate text-xs text-muted" title={l.observacoes}>{l.observacoes}</p>}
                        </td>
                        <td className="text-sm">{optionLabel(CONTEMPLACAO, l.tipo)}</td>
                        <td className="text-right tabular-nums">
                          {v !== null ? <span className="font-semibold">{brl(v)}</span> : <span className="text-muted">—</span>}
                          {l.percentual !== null && <div className="text-xs text-muted">{pct(l.percentual, 2)}</div>}
                        </td>
                        <td>{canWrite ? <LanceResultadoSelect id={l.id} value={l.resultado} /> : <StatusBadge options={LANCE_RESULTADO} value={l.resultado} />}</td>
                        <td>
                          <div className="flex justify-end gap-1">
                            {canWrite && (
                              <FormDrawerButton
                                action={updateLance}
                                fields={lanceFields}
                                hidden={{ id: l.id, cota_id: id }}
                                values={{ ...l }}
                                title="Editar lance"
                                description={titulo}
                                icon="edit"
                                variant="ghost"
                                size="icon"
                                width="max-w-lg"
                              />
                            )}
                            {canDelete && <ConfirmAction action={deleteLance} id={l.id} title="Remover lance?" message="O registro do lance será removido. O status da cota não é alterado." />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
