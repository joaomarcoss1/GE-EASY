import type { Metadata } from "next";
import { ArrowDownToLine, BadgeDollarSign, Banknote, HandCoins, PiggyBank, Receipt, Undo2, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isBackofficeRole } from "@/lib/rbac";
import { clienteOptions, consultorOptions, getProfileMap } from "@/lib/data";
import { COMISSAO_STATUS, LINHAS } from "@/lib/constants";
import { brl, num, pct } from "@/lib/format";
import { createComissaoManual } from "@/lib/actions/comissoes";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { LinkButton } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filters";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { MonthPicker } from "@/components/comissoes/month-picker";
import { ComissoesTable, ExtratoTable, type ComissaoView } from "@/components/comissoes/comissoes-table";
import { fetchAll } from "@/components/dashboard/fetch-all";
import { firstDay, monthLong, monthParam, sum } from "@/components/dashboard/periods";

export const metadata: Metadata = { title: "Comissões" };

type Num = number | string;
interface Row {
  id: string;
  linha: "consorcio" | "seguro";
  descricao: string | null;
  cliente_id: string | null;
  consultor_id: string | null;
  competencia: string;
  base_calculo: Num;
  percentual_corretora: Num;
  valor_corretora: Num;
  percentual_consultor: Num;
  valor_consultor: Num;
  status: ComissaoView["status"];
  data_recebimento: string | null;
  data_pagamento: string | null;
  observacoes: string | null;
  clientes: { nome: string } | { nome: string }[] | null;
}

const STATUS_VALUES = COMISSAO_STATUS.map((s) => s.value);
const LINHA_VALUES = LINHAS.map((l) => l.value);

export default async function ComissoesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("comissoes.view");
  const sp = await searchParams;
  const mes = monthParam(sp.mes);
  const backoffice = isBackofficeRole(profile.role);
  const canManage = can(profile, "comissoes.manage");
  const status = sp.status && STATUS_VALUES.includes(sp.status) ? sp.status : null;
  const linha = sp.linha && LINHA_VALUES.includes(sp.linha) ? sp.linha : null;
  const consultor = backoffice && sp.consultor && /^[0-9a-f-]{36}$/i.test(sp.consultor) ? sp.consultor : null;

  const supabase = await createClient();
  const [data, profiles, consultores, clientes] = await Promise.all([
    fetchAll<Row>((f, t) => {
      let q = supabase
        .from("comissoes")
        .select(
          "id, linha, descricao, cliente_id, consultor_id, competencia, base_calculo, percentual_corretora, valor_corretora, percentual_consultor, valor_consultor, status, data_recebimento, data_pagamento, observacoes, clientes(nome)",
        )
        .eq("competencia", firstDay(mes));
      if (status) q = q.eq("status", status);
      if (linha) q = q.eq("linha", linha);
      if (consultor) q = q.eq("consultor_id", consultor);
      // Consultores: o RLS já restringe às próprias; o filtro explícito evita surpresas.
      if (!backoffice) q = q.eq("consultor_id", userId);
      return q.order("created_at", { ascending: false }).order("id").range(f, t);
    }, 5000),
    getProfileMap(),
    backoffice ? consultorOptions() : Promise.resolve([]),
    canManage ? clienteOptions() : Promise.resolve([]),
  ]);

  const rows: ComissaoView[] = data.map((r) => ({
    id: r.id,
    linha: r.linha,
    descricao: r.descricao,
    cliente_id: r.cliente_id,
    cliente_nome: (Array.isArray(r.clientes) ? r.clientes[0]?.nome : r.clientes?.nome) ?? null,
    consultor_nome: r.consultor_id ? (profiles.get(r.consultor_id)?.full_name ?? null) : null,
    competencia: r.competencia,
    base_calculo: Number(r.base_calculo),
    percentual_corretora: Number(r.percentual_corretora),
    valor_corretora: Number(r.valor_corretora),
    percentual_consultor: Number(r.percentual_consultor),
    valor_consultor: Number(r.valor_consultor),
    status: r.status,
    data_recebimento: r.data_recebimento,
    data_pagamento: r.data_pagamento,
    observacoes: r.observacoes,
  }));

  const ativas = rows.filter((r) => r.status !== "estornada");
  const by = (...st: ComissaoView["status"][]) => rows.filter((r) => st.includes(r.status));

  const exportHref = `/api/exportar/comissoes?mes=${mes}`;
  const filtered = !!(status || linha || consultor);

  const manualFields: FieldDef[] = [
    { name: "linha", label: "Linha", type: "select", options: LINHAS, emptyOption: false, span: 2, required: true },
    { name: "descricao", label: "Descrição", required: true, span: 4, placeholder: "Ex.: Bônus de campanha, ajuste de comissão…" },
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, emptyOption: "Sem cliente", span: 3 },
    { name: "consultor_id", label: "Consultor", type: "select", options: consultores, emptyOption: "Sem consultor", span: 3 },
    { name: "competencia", label: "Competência", type: "date", required: true, span: 2, help: "Qualquer dia do mês" },
    { name: "base_calculo", label: "Base de cálculo", type: "money", required: true, span: 4 },
    { name: "percentual_corretora", label: "% da corretora", type: "percent", required: true, span: 3, help: "Sobre a base de cálculo" },
    { name: "percentual_consultor", label: "% do consultor", type: "percent", span: 3, help: "Sobre o valor da corretora. Vazio = % do cadastro do consultor" },
    { name: "status", label: "Status", type: "select", options: COMISSAO_STATUS, emptyOption: false, span: 3 },
    { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6 },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Financeiro"
        title={backoffice ? "Comissões" : "Meu extrato de comissões"}
        description={
          backoffice
            ? `Recebimentos das administradoras/seguradoras e repasses aos consultores · ${monthLong(mes)}`
            : `Suas comissões da competência ${monthLong(mes)}`
        }
        actions={
          <>
            <MonthPicker value={mes} />
            <LinkButton href={exportHref} variant="secondary" prefetch={false}>
              <ArrowDownToLine className="h-4 w-4" /> Exportar CSV
            </LinkButton>
            {canManage && (
              <FormDrawerButton
                action={createComissaoManual}
                fields={manualFields}
                values={{ linha: "consorcio", competencia: firstDay(mes), status: "prevista" }}
                title="Lançar comissão manual"
                label="Nova comissão"
                variant="accent"
                description="Para bônus, ajustes ou negócios fora do sistema. Comissões de cotas e apólices são geradas automaticamente."
              />
            )}
          </>
        }
      />

      {backoffice ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="A receber das parceiras"
            value={brl(sum(by("prevista"), (r) => r.valor_corretora))}
            icon={<Receipt className="h-5 w-5" />}
            tone="amber"
            hint={`${num(by("prevista").length)} prevista(s) · administradoras e seguradoras`}
          />
          <StatCard
            label="Recebido"
            value={brl(sum(by("recebida", "paga"), (r) => r.valor_corretora))}
            icon={<Banknote className="h-5 w-5" />}
            hint={`${num(by("recebida", "paga").length)} comissão(ões) recebida(s)`}
          />
          <StatCard
            label="Pago aos consultores"
            value={brl(sum(by("paga"), (r) => r.valor_consultor))}
            icon={<HandCoins className="h-5 w-5" />}
            tone="accent"
            hint={`a pagar: ${brl(sum(by("prevista", "recebida"), (r) => r.valor_consultor))}`}
          />
          {(() => {
            const bruto = sum(ativas, (r) => r.valor_corretora);
            const margem = Math.round((bruto - sum(ativas, (r) => r.valor_consultor)) * 100) / 100;
            return <StatCard label="Margem da corretora" value={brl(margem)} icon={<PiggyBank className="h-5 w-5" />} tone="green" hint={bruto ? `${pct((margem / bruto) * 100)} da comissão bruta` : "sem comissões no mês"} />;
          })()}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total do mês" value={brl(sum(ativas, (r) => r.valor_consultor))} icon={<Wallet className="h-5 w-5" />} hint={`${num(ativas.length)} comissão(ões)`} />
          <StatCard label="A receber" value={brl(sum(by("prevista", "recebida"), (r) => r.valor_consultor))} icon={<BadgeDollarSign className="h-5 w-5" />} tone="amber" hint="aguardando repasse" />
          <StatCard label="Já recebido" value={brl(sum(by("paga"), (r) => r.valor_consultor))} icon={<HandCoins className="h-5 w-5" />} tone="green" hint={`${num(by("paga").length)} paga(s)`} />
          <StatCard label="Estornado" value={brl(sum(by("estornada"), (r) => r.valor_consultor))} icon={<Undo2 className="h-5 w-5" />} tone="accent" hint="cancelamentos" />
        </div>
      )}

      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <FilterSelect param="status" options={COMISSAO_STATUS} allLabel="Todos os status" />
          <FilterSelect param="linha" options={LINHAS} allLabel="Todas as linhas" />
          {backoffice && <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" />}
          {canManage && rows.length > 0 && <p className="text-xs text-muted sm:ml-auto">Selecione linhas para marcar como recebidas ou pagas em lote.</p>}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="Nenhuma comissão nesta competência"
            description={filtered ? "Ajuste os filtros para ver mais resultados." : "As comissões são geradas automaticamente quando uma cota é ativada ou uma apólice entra em vigência."}
          />
        ) : backoffice ? (
          <ComissoesTable rows={rows} canManage={canManage} />
        ) : (
          <ExtratoTable rows={rows} />
        )}
      </Card>
    </>
  );
}
