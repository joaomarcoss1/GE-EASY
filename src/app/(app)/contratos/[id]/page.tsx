import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarRange, FileSignature, Repeat, Scale, Timer, Trophy, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, departamentoOptions, getProfileMap, juridicoOptions, processoOptions } from "@/lib/data";
import { CONTRATO_STATUS, CONTRATO_TIPOS } from "@/lib/constants";
import { brl, date, pct, todayISO } from "@/lib/format";
import type { ContratoHonorarios, FinanceiroLancamento } from "@/lib/types";
import { deleteContrato, gerarParcelas, registrarExito, saveContrato } from "@/lib/actions/contratos";
import { baixarEmLote, baixarLancamento, cancelarLancamento, deleteLancamento, estornarLancamento, saveLancamento } from "@/lib/actions/financeiro";
import { faturarHoras } from "@/lib/actions/horas";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { optionLabel } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { Progress } from "@/components/ui/progress";
import { contratoFields, descricaoHonorarios, lancamentoFields } from "@/components/financeiro/fields";
import { LancamentosTable, type LancRow } from "@/components/financeiro/lancamentos-table";

export const metadata: Metadata = { title: "Contrato de honorários" };

export default async function ContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requirePermission("contratos.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("contratos_honorarios").select("*").eq("id", id).maybeSingle<ContratoHonorarios>();
  if (!c) notFound();

  const fin = can(profile, "financeiro.view");
  const [{ data: cliente }, { data: processo }, { data: parcelas }, { data: horas }, profiles] = await Promise.all([
    supabase.from("clientes").select("id, nome, documento").eq("id", c.cliente_id).maybeSingle(),
    c.processo_id ? supabase.from("processos").select("id, titulo, numero_cnj, valor_causa").eq("id", c.processo_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("financeiro_lancamentos").select("*").eq("contrato_id", id).order("vencimento"),
    supabase.from("horas_lancamentos").select("id, minutos, faturado, faturavel, valor_hora, data, descricao, user_id").or(`contrato_id.eq.${id}${c.processo_id ? `,processo_id.eq.${c.processo_id}` : ""}`).order("data", { ascending: false }).limit(500),
    getProfileMap(),
  ]);
  const lancs = (parcelas ?? []) as FinanceiroLancamento[];
  const recebido = lancs.filter((l) => l.status === "pago").reduce((a, l) => a + Number(l.valor), 0);
  const total = lancs.filter((l) => l.status !== "cancelado").reduce((a, l) => a + Number(l.valor), 0);
  const hs = horas ?? [];
  const minPend = hs.filter((h) => h.faturavel && !h.faturado).reduce((a, h) => a + h.minutos, 0);
  const minTot = hs.reduce((a, h) => a + h.minutos, 0);
  const pendIds = hs.filter((h) => h.faturavel && !h.faturado).map((h) => h.id);

  const canWrite = can(profile, "contratos.write");
  const [clientes, processos, departamentos, juridico] = canWrite || fin ? await Promise.all([clienteOptions(), processoOptions(), departamentoOptions(), juridicoOptions()]) : [[], [], [], []];
  const opts = { clientes, processos, departamentos };
  const rows: LancRow[] = lancs.map((l) => ({
    id: l.id, tipo: l.tipo, categoria: l.categoria, descricao: l.descricao, valor: Number(l.valor), vencimento: l.vencimento, data_pagamento: l.data_pagamento,
    status: l.status, cliente: null, processo: null, parcela: l.parcela, total_parcelas: l.total_parcelas, reembolsavel: l.reembolsavel,
    values: { ...l } as unknown as LancRow["values"],
  }));

  return (
    <>
      <Link href="/contratos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" /> Contratos</Link>
      <Card className="mb-6 overflow-hidden">
        <div className="brand-gradient px-6 py-5 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent-200">{optionLabel(CONTRATO_TIPOS, c.tipo)}{c.numero ? ` · Nº ${c.numero}` : ""}</p>
              <h1 className="text-2xl font-bold tracking-tight">{c.titulo}</h1>
              <p className="mt-1 text-sm text-white/80">
                Cliente: {cliente ? <Link href={`/clientes/${cliente.id}`} className="font-semibold underline-offset-2 hover:underline">{cliente.nome}</Link> : "—"}
                {processo && <> · Processo: <Link href={`/processos/${processo.id}`} className="font-semibold underline-offset-2 hover:underline">{processo.titulo}</Link></>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/modelos/gerar?contrato_id=${id}&cliente_id=${c.cliente_id}${c.processo_id ? `&processo_id=${c.processo_id}` : ""}`} variant="secondary"><FileSignature className="h-4 w-4" /> Gerar contrato</LinkButton>
              {canWrite && (
                <FormDrawerButton action={saveContrato} fields={contratoFields({ clientes, processos, departamentos, juridico })} values={{ ...c }} hidden={{ id }} title="Editar contrato" label="Editar" icon="edit" variant="secondary" width="max-w-3xl" />
              )}
              {can(profile, "processos.delete") && <ConfirmAction action={deleteContrato} id={id} title="Excluir contrato?" message="As parcelas geradas no financeiro também serão excluídas." redirectTo="/contratos" variant="secondary" />}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Honorários", value: descricaoHonorarios(c), icon: Wallet },
            { label: "Vigência", value: `${date(c.data_inicio)}${c.data_fim ? ` → ${date(c.data_fim)}` : " (indeterminada)"}`, icon: CalendarRange },
            { label: "Responsável", value: c.responsavel_id ? (profiles.get(c.responsavel_id)?.full_name ?? "—") : "—", icon: Scale },
            { label: "Situação", value: optionLabel(CONTRATO_STATUS, c.status), icon: Repeat },
          ].map((k) => (
            <div key={k.label} className="flex items-start gap-3 border-b border-line px-6 py-4 lg:border-b-0 lg:[&:not(:last-child)]:border-r">
              <k.icon className="mt-0.5 h-5 w-5 shrink-0 text-accent-500" />
              <div className="min-w-0"><p className="text-xs text-muted">{k.label}</p><p className="text-sm font-semibold">{k.value}</p></div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs text-muted">Recebido / total lançado</p>
          <p className="mt-1 text-xl font-bold">{brl(recebido)} <span className="text-sm font-medium text-muted">de {brl(total)}</span></p>
          <Progress value={total ? (recebido / total) * 100 : 0} tone="green" className="mt-3" />
          <p className="mt-1 text-xs text-muted">{pct(total ? (recebido / total) * 100 : 0, 0)} recebido</p>
        </Card>
        {(c.tipo === "exito" || c.tipo === "misto") && (
          <Card className="p-5">
            <p className="flex items-center gap-2 text-xs text-muted"><Trophy className="h-4 w-4 text-amber-500" /> Êxito de {pct(c.percentual_exito ?? 0)}</p>
            <p className="mt-1 text-sm">Valor da causa: <b>{processo?.valor_causa ? brl(processo.valor_causa) : "—"}</b></p>
            {fin && (
              <div className="mt-3">
                <FormDrawerButton action={registrarExito} hidden={{ contrato_id: id }} fields={[{ name: "proveito", label: "Proveito econômico obtido", type: "money", required: true, span: 3 }, { name: "vencimento", label: "Vencimento", type: "date", required: true, span: 3 }]} values={{ vencimento: todayISO() }} title="Registrar êxito" label="Registrar êxito" size="sm" variant="outline" width="max-w-md" icon="none" />
              </div>
            )}
          </Card>
        )}
        <Card className="p-5">
          <p className="flex items-center gap-2 text-xs text-muted"><Timer className="h-4 w-4 text-brand-500" /> Horas vinculadas</p>
          <p className="mt-1 text-xl font-bold">{(minTot / 60).toFixed(1).replace(".", ",")} h</p>
          <p className="text-xs text-muted">{(minPend / 60).toFixed(1).replace(".", ",")} h faturáveis pendentes{c.valor_hora ? ` · ${brl((minPend / 60) * Number(c.valor_hora))}` : ""}</p>
          {fin && pendIds.length > 0 && (
            <div className="mt-3">
              <ConfirmAction action={async () => { "use server"; return faturarHoras(pendIds, id); }} id={id} title="Faturar horas pendentes?" message="Será criada uma receita no financeiro com o total das horas faturáveis pendentes." confirmLabel="Faturar" label="Faturar horas" variant="outline" size="sm" danger={false} icon={<Timer className="h-4 w-4" />} />
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Parcelas e lançamentos"
          description="Contas a receber geradas a partir do contrato"
          icon={<Wallet className="h-4 w-4" />}
          action={
            fin && (
              <div className="flex gap-2">
                {["fixo", "mensal", "misto"].includes(c.tipo) && (
                  <ConfirmAction action={async () => { "use server"; return gerarParcelas(id, lancs.length > 0); }} id={id} title={lancs.length ? "Regerar parcelas em aberto?" : "Gerar parcelas?"} message={lancs.length ? "As parcelas em aberto serão recriadas conforme as condições atuais; as já pagas são mantidas." : "As parcelas serão criadas no contas a receber conforme as condições do contrato."} confirmLabel="Gerar" label={lancs.length ? "Regerar parcelas" : "Gerar parcelas"} variant="primary" size="sm" danger={false} icon={<Repeat className="h-4 w-4" />} />
                )}
                <FormDrawerButton action={saveLancamento} fields={lancamentoFields("receita", opts, true)} values={{ tipo: "receita", categoria: "Honorários contratuais", status: "aberto", vencimento: todayISO(), cliente_id: c.cliente_id, processo_id: c.processo_id, contrato_id: id, repetir: 1 }} hidden={{ contrato_id: id }} title="Lançamento avulso" label="Avulso" size="sm" variant="secondary" width="max-w-2xl" />
              </div>
            )
          }
        />
        {rows.length === 0 ? (
          <EmptyState title="Nenhuma parcela lançada" description={fin ? "Use “Gerar parcelas” para criar o contas a receber deste contrato." : "O financeiro ainda não gerou as parcelas deste contrato."} />
        ) : (
          <LancamentosTable rows={rows} editFields={{ receita: lancamentoFields("receita", opts, false), despesa: lancamentoFields("despesa", opts, false) }} canManage={fin} actions={{ save: saveLancamento, baixar: baixarLancamento, estornar: estornarLancamento, cancelar: cancelarLancamento, remove: deleteLancamento, lote: baixarEmLote }} />
        )}
      </Card>

      {c.observacoes && (
        <Card className="mt-6">
          <CardHeader title="Cláusulas e observações" />
          <CardBody><p className="whitespace-pre-wrap text-sm">{c.observacoes}</p></CardBody>
        </Card>
      )}
    </>
  );
}
