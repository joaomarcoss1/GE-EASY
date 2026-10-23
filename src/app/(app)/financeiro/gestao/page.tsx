import type { Metadata } from "next";
import { Banknote, Landmark, Repeat, ShieldCheck, Upload } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, departamentoOptions } from "@/lib/data";
import { FIN_CATEGORIAS_DESPESA, FIN_CATEGORIAS_RECEITA } from "@/lib/constants";
import { brl, date } from "@/lib/format";
import { conciliarMovimento, conciliarSugestoes, decidirAprovacao, importarExtrato, salvarCentroCusto, salvarContaBancaria, salvarParametrosFinanceiro, salvarRecorrencia } from "@/lib/actions/financeiro";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ActionButton } from "@/components/ui/action-button";
import { LinkTabs } from "@/components/ui/tabs";
import { SettingsForm } from "@/components/configuracoes/settings-form";
import type { FieldDef } from "@/components/ui/form";

export const metadata: Metadata = { title: "Gestão financeira" };

/** Aprovações por alçada, contas recorrentes, extrato/conciliação bancária, centros de custo e contas. */
export default async function GestaoFinanceiraPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("financeiro.view");
  const sp = await searchParams;
  const tabs = [
    { key: "aprovacoes", label: "Aprovações" },
    { key: "recorrencias", label: "Contas recorrentes" },
    { key: "conciliacao", label: "Conciliação bancária" },
    { key: "cadastros", label: "Centros de custo e contas" },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "aprovacoes";
  const supabase = await createClient();
  const [{ data: centros }, { data: contas }] = await Promise.all([
    supabase.from("centros_custo").select("*").order("nome"),
    supabase.from("contas_bancarias").select("*").order("nome"),
  ]);
  const opCentros = (centros ?? []).filter((c) => c.ativo).map((c) => ({ value: c.id as string, label: c.nome as string }));
  const opContas = (contas ?? []).filter((c) => c.ativo).map((c) => ({ value: c.id as string, label: c.nome as string }));
  const concilia = can(profile, "financeiro.conciliar");
  return (
    <>
      <PageHeader eyebrow="Financeiro" title="Gestão financeira" description="Despesas acima da alçada só são pagas após aprovação de outra pessoa; contas fixas são lançadas sozinhas todo mês." />
      <LinkTabs base="/financeiro/gestao" tabs={tabs} active={tab} />
      {tab === "aprovacoes" && <Aprovacoes paga={can(profile, "financeiro.pagar")} />}
      {tab === "recorrencias" && <Recorrencias concilia={concilia} centros={opCentros} contas={opContas} />}
      {tab === "conciliacao" && <Conciliacao concilia={concilia} contas={opContas} conta={sp.conta} />}
      {tab === "cadastros" && <Cadastros concilia={concilia} paga={can(profile, "financeiro.pagar")} centros={centros ?? []} contas={contas ?? []} />}
    </>
  );
}

async function Aprovacoes({ paga }: { paga: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("financeiro_lancamentos").select("id, descricao, categoria, valor, vencimento, fornecedor, created_by, aprovacao, aprovacao_obs")
    .in("aprovacao", ["pendente", "recusada"]).neq("status", "cancelado").order("vencimento").limit(200);
  return (
    <Card>
      <CardHeader title="Despesas aguardando aprovação" description="Quem lançou não aprova a própria despesa." icon={<ShieldCheck className="h-4 w-4" />} />
      {!data?.length ? <EmptyState title="Nada pendente" /> : (
        <div className="overflow-x-auto"><table className="table-base">
          <thead><tr><th>Vencimento</th><th>Despesa</th><th>Fornecedor</th><th className="text-right">Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>{data.map((l) => (
            <tr key={l.id}>
              <td className="whitespace-nowrap text-sm">{date(l.vencimento)}</td>
              <td><p className="font-medium">{l.descricao}</p><p className="text-xs text-muted">{l.categoria}</p></td>
              <td className="text-sm">{l.fornecedor ?? "—"}</td>
              <td className="text-right font-semibold">{brl(l.valor)}</td>
              <td className="text-sm">{l.aprovacao === "recusada" ? <span className="text-red-600">Recusada{l.aprovacao_obs ? `: ${l.aprovacao_obs}` : ""}</span> : <span className="text-amber-600">Pendente</span>}</td>
              <td className="text-right">{paga && l.aprovacao === "pendente" && (
                <FormDrawerButton action={decidirAprovacao} title="Decidir despesa" label="Decidir" icon="none" variant="outline" size="sm" hidden={{ id: l.id }}
                  fields={[{ name: "aprovar", label: "Decisão", type: "select", options: [{ value: "sim", label: "Aprovar" }, { value: "nao", label: "Recusar" }], required: true, span: 6 }, { name: "observacao", label: "Observação (obrigatória para recusar)", type: "textarea", rows: 2, span: 6 }]} />
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

async function Recorrencias({ concilia, centros, contas }: { concilia: boolean; centros: { value: string; label: string }[]; contas: { value: string; label: string }[] }) {
  const supabase = await createClient();
  const [{ data }, deps, clientes] = await Promise.all([supabase.from("financeiro_recorrencias").select("*").order("descricao"), departamentoOptions(), clienteOptions()]);
  const campos: FieldDef[] = [
    { name: "tipo", label: "Tipo", type: "select", options: [{ value: "despesa", label: "Despesa (conta a pagar)" }, { value: "receita", label: "Receita (mensalidade)" }], required: true, span: 3 },
    { name: "categoria", label: "Categoria", type: "select", options: [...FIN_CATEGORIAS_DESPESA, ...FIN_CATEGORIAS_RECEITA], required: true, span: 3 },
    { name: "descricao", label: "Descrição", required: true, span: 6, placeholder: "Aluguel da sede, internet, sistema…" },
    { name: "valor", label: "Valor mensal", type: "money", required: true, span: 2 },
    { name: "dia_vencimento", label: "Dia do vencimento", type: "number", min: 1, max: 31, required: true, span: 2 },
    { name: "fornecedor", label: "Fornecedor", span: 2 },
    { name: "inicio", label: "A partir de", type: "date", required: true, span: 3 },
    { name: "fim", label: "Até (opcional)", type: "date", span: 3 },
    { name: "centro_custo_id", label: "Centro de custo", type: "select", options: centros, span: 3 },
    { name: "conta_id", label: "Conta bancária", type: "select", options: contas, span: 3 },
    { name: "departamento_id", label: "Departamento", type: "select", options: deps, span: 3 },
    { name: "cliente_id", label: "Cliente (receitas)", type: "select", options: clientes, span: 3 },
    { name: "ativo", label: "Ativa", type: "checkbox", span: 6 },
  ];
  return (
    <Card>
      <CardHeader title="Contas recorrentes" description="Geradas automaticamente para o mês atual e o seguinte (dia 31 vira o último dia do mês)." icon={<Repeat className="h-4 w-4" />}
        action={concilia && <FormDrawerButton action={salvarRecorrencia} title="Nova conta recorrente" label="Nova" size="sm" width="max-w-2xl" values={{ tipo: "despesa", dia_vencimento: 10, inicio: new Date().toISOString().slice(0, 10), ativo: true }} fields={campos} />} />
      {!data?.length ? <EmptyState title="Nenhuma recorrência" /> : (
        <ul className="divide-y divide-line text-sm">{data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div><p className="font-medium">{r.descricao} {!r.ativo && <span className="text-xs text-muted">(inativa)</span>}</p><p className="text-xs text-muted">{r.tipo === "despesa" ? "Despesa" : "Receita"} · {brl(r.valor)} todo dia {r.dia_vencimento} · desde {date(r.inicio)}{r.fim ? ` até ${date(r.fim)}` : ""}{r.ultima_competencia ? ` · gerada até ${String(r.ultima_competencia).slice(5, 7)}/${String(r.ultima_competencia).slice(0, 4)}` : ""}</p></div>
            {concilia && <FormDrawerButton action={salvarRecorrencia} title="Editar recorrência" icon="edit" variant="ghost" size="sm" width="max-w-2xl" hidden={{ id: r.id }} values={r} fields={campos} />}
          </li>
        ))}</ul>
      )}
    </Card>
  );
}

async function Conciliacao({ concilia, contas, conta }: { concilia: boolean; contas: { value: string; label: string }[]; conta?: string }) {
  if (!contas.length) return <EmptyState icon={<Landmark className="h-6 w-6" />} title="Cadastre uma conta bancária" description="Na aba Centros de custo e contas." />;
  const sel = contas.find((c) => c.value === conta) ?? contas[0];
  const supabase = await createClient();
  const [{ data: movs }, { data: sug }, { data: abertos }] = await Promise.all([
    supabase.from("extrato_movimentos").select("id, data, valor, descricao, lancamento_id").eq("conta_id", sel.value).order("data", { ascending: false }).limit(200),
    supabase.rpc("sugerir_conciliacao", { p_conta: sel.value }),
    supabase.from("financeiro_lancamentos").select("id, descricao, valor, vencimento, tipo").eq("conciliado", false).neq("status", "cancelado").order("vencimento").limit(400),
  ]);
  const sugestao = new Map(((sug ?? []) as { movimento_id: string; lancamento_id: string }[]).map((s) => [s.movimento_id, s.lancamento_id]));
  const porId = new Map((abertos ?? []).map((l) => [l.id as string, l]));
  const pendentes = (movs ?? []).filter((m) => !m.lancamento_id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex gap-2"><input type="hidden" name="tab" value="conciliacao" />
          <select className="input" name="conta" defaultValue={sel.value}>{contas.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          <button className="rounded-xl border border-line px-3 text-sm font-semibold">Ver</button>
        </form>
        {concilia && <FormDrawerButton action={importarExtrato} title="Importar extrato OFX" label="Importar OFX" variant="accent" size="sm" values={{ conta_id: sel.value }}
          description="Exporte o extrato no internet banking no formato OFX (Money/Quicken). Movimentos já importados são ignorados."
          fields={[{ name: "conta_id", label: "Conta", type: "select", options: contas, required: true, span: 6 }, { name: "arquivo", label: "Arquivo OFX", type: "file", placeholder: ".ofx", required: true, span: 6 }]} />}
        {concilia && sugestao.size > 0 && <ActionButton action={conciliarSugestoes.bind(null, sel.value)} label={`Confirmar ${sugestao.size} sugestão(ões)`} variant="primary" />}
      </div>
      <Card>
        <CardHeader title={`Extrato — ${sel.label}`} description={`${pendentes.length} movimento(s) sem conciliação`} icon={<Upload className="h-4 w-4" />} />
        {!movs?.length ? <EmptyState title="Nenhum movimento importado" /> : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Data</th><th>Descrição</th><th className="text-right">Valor</th><th>Lançamento</th><th /></tr></thead>
            <tbody>{movs.map((m) => {
              const s = sugestao.get(m.id);
              const sl = s ? porId.get(s) : null;
              const opcoes = (abertos ?? []).filter((l) => (l.tipo === "receita") === (Number(m.valor) > 0)).map((l) => ({ value: l.id as string, label: `${date(l.vencimento)} · ${l.descricao} · ${brl(l.valor)}` }));
              return (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-sm">{date(m.data)}</td>
                  <td className="text-sm">{m.descricao}</td>
                  <td className={`text-right font-semibold ${Number(m.valor) < 0 ? "text-red-600" : "text-emerald-700"}`}>{brl(m.valor)}</td>
                  <td className="text-xs">{m.lancamento_id ? <span className="text-emerald-700">Conciliado</span> : sl ? <span className="text-brand-600">Sugestão: {sl.descricao}</span> : <span className="text-muted">—</span>}</td>
                  <td className="text-right">{concilia && !m.lancamento_id && (
                    <FormDrawerButton action={conciliarMovimento} title="Conciliar movimento" label="Conciliar" icon="none" variant="outline" size="sm" hidden={{ movimento_id: m.id }} values={{ lancamento_id: s ?? "" }}
                      fields={[{ name: "lancamento_id", label: "Lançamento correspondente", type: "select", options: opcoes, required: true, span: 6, help: "O valor precisa ser igual; a baixa usa a data do extrato" }]} />
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

async function Cadastros({ concilia, paga, centros, contas }: { concilia: boolean; paga: boolean; centros: Record<string, unknown>[]; contas: Record<string, unknown>[] }) {
  const supabase = await createClient();
  const [deps, { data: cfg }] = await Promise.all([departamentoOptions(), supabase.from("configuracoes").select("valor").eq("chave", "financeiro").maybeSingle()]);
  const camposCentro: FieldDef[] = [
    { name: "nome", label: "Nome", required: true, span: 6 },
    { name: "tipo", label: "Tipo", type: "select", options: ["departamento", "rota", "equipe", "campanha", "projeto", "outro"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })), required: true, span: 3 },
    { name: "departamento_id", label: "Departamento", type: "select", options: deps, span: 3 },
    { name: "ativo", label: "Ativo", type: "checkbox", span: 6 },
  ];
  const camposConta: FieldDef[] = [
    { name: "nome", label: "Nome", required: true, span: 6 }, { name: "banco", label: "Banco", span: 2 }, { name: "agencia", label: "Agência", span: 2 }, { name: "conta", label: "Conta", span: 2 },
    { name: "saldo_inicial", label: "Saldo inicial", type: "money", span: 3 }, { name: "saldo_inicial_em", label: "Saldo em", type: "date", span: 3 }, { name: "ativo", label: "Ativa", type: "checkbox", span: 6 },
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="self-start">
        <CardHeader title="Centros de custo" description="Por departamento, rota, equipe ou campanha — para o custo por cliente e a rentabilidade."
          action={concilia && <FormDrawerButton action={salvarCentroCusto} title="Novo centro de custo" label="Novo" size="sm" values={{ tipo: "departamento", ativo: true }} fields={camposCentro} />} />
        {!centros.length ? <EmptyState title="Nenhum centro de custo" /> : (
          <ul className="divide-y divide-line text-sm">{centros.map((c) => (
            <li key={c.id as string} className="flex items-center justify-between px-5 py-2.5"><span>{c.nome as string} <span className="text-xs text-muted">{c.tipo as string}{!c.ativo ? " · inativo" : ""}</span></span>
              {concilia && <FormDrawerButton action={salvarCentroCusto} title="Editar centro" icon="edit" variant="ghost" size="sm" hidden={{ id: c.id as string }} values={c as Record<string, string>} fields={camposCentro} />}</li>
          ))}</ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Contas bancárias" icon={<Banknote className="h-4 w-4" />}
          action={concilia && <FormDrawerButton action={salvarContaBancaria} title="Nova conta" label="Nova" size="sm" values={{ ativo: true }} fields={camposConta} />} />
        {!contas.length ? <EmptyState title="Nenhuma conta" /> : (
          <ul className="divide-y divide-line text-sm">{contas.map((c) => (
            <li key={c.id as string} className="flex items-center justify-between px-5 py-2.5"><span>{c.nome as string} <span className="text-xs text-muted">{[c.banco, c.agencia, c.conta].filter(Boolean).join(" · ")}</span></span>
              {concilia && <FormDrawerButton action={salvarContaBancaria} title="Editar conta" icon="edit" variant="ghost" size="sm" hidden={{ id: c.id as string }} values={c as Record<string, string>} fields={camposConta} />}</li>
          ))}</ul>
        )}
      </Card>
      <Card className="self-start">
        <CardHeader title="Alçada de aprovação" icon={<ShieldCheck className="h-4 w-4" />} />
        <CardBody>
          {paga ? (
            <SettingsForm action={salvarParametrosFinanceiro} values={{ alcada_aprovacao: ((cfg?.valor ?? {}) as { alcada_aprovacao?: number }).alcada_aprovacao ?? 5000 }}
              fields={[{ name: "alcada_aprovacao", label: "Despesas a partir de (R$) exigem aprovação", type: "money", help: "0 desliga a aprovação" }]} />
          ) : <p className="text-sm text-muted">Alçada atual: {brl(((cfg?.valor ?? {}) as { alcada_aprovacao?: number }).alcada_aprovacao ?? 5000)}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
