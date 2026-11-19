import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Target, Users, UsersRound, Building2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { userOptions } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { ASSESSOR_CATEGORIAS, META_ALVOS, META_INDICADORES, META_PERIODICIDADES } from "@/lib/constants";
import { num, todayISO } from "@/lib/format";
import { excluirMetaProcesso, salvarMetaProcesso } from "@/lib/actions/metas-processos";
import type { FieldDef } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { LinkButton } from "@/components/ui/button";
import { addDays, isISODate, monthLong } from "@/components/dashboard/periods";
import { MetaProgresso, type MetaLinha } from "@/components/metas/metas-processos";

export const metadata: Metadata = { title: "Metas" };

interface MetaCadastro {
  id: string;
  nome: string;
  indicador: string;
  periodicidade: string;
  alvo: string;
  assessor_id: string | null;
  categoria: string | null;
  valor: number;
  ativo: boolean;
  usuario_id: string | null;
  assessores: { nome: string } | { nome: string }[] | null;
}

function metaFields(assessores: { value: string; label: string }[], usuarios: { value: string; label: string }[], edit: boolean): FieldDef[] {
  return [
    { name: "nome", label: "Nome da meta", required: true, span: 6, placeholder: "Ex.: José — processos no mês" },
    { name: "indicador", label: "O que medir", type: "select", options: META_INDICADORES, required: true, span: 3 },
    { name: "periodicidade", label: "Período", type: "select", options: META_PERIODICIDADES, required: true, span: 3 },
    { name: "alvo", label: "Para quem", type: "select", options: META_ALVOS, required: true, emptyOption: false, span: 6, help: "Categoria: a meta vale para cada assessor da categoria (ex.: cada corretor)." },
    { name: "assessor_id", label: "Assessor (se for de um assessor)", type: "select", options: assessores, span: 3 },
    { name: "usuario_id", label: "Funcionário (se for de um funcionário)", type: "select", options: usuarios, span: 3 },
    { name: "categoria", label: "Categoria (se for por categoria)", type: "select", options: ASSESSOR_CATEGORIAS, span: 3 },
    { name: "valor", label: "Meta (quantidade)", type: "number", required: true, min: 1, span: 3 },
    ...(edit ? [{ name: "ativo", label: "Meta ativa", type: "checkbox", span: 3 } as FieldDef] : []),
  ];
}

/** Metas de processos: diretoria, geral (habilitações e judicializados), consultores, corretores e ligações. */
export default async function MetasProcessosPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { profile } = await requirePermission("clientes.view");
  const { ref: refParam } = await searchParams;
  const hoje = todayISO();
  const ref = isISODate(refParam) && refParam <= hoje ? refParam : hoje;
  const manage = can(profile, "metas.manage");
  const supabase = await createClient();
  const [{ data: painel, error }, { data: cadastro }, { data: assessoresData }, usuarios] = await Promise.all([
    supabase.rpc("metas_processos_painel", { p_ref: ref }),
    manage ? supabase.from("metas_processos").select("id, nome, indicador, periodicidade, alvo, assessor_id, usuario_id, categoria, valor, ativo, assessores(nome)").order("alvo").order("nome") : Promise.resolve({ data: [] }),
    manage ? supabase.from("assessores").select("id, nome").eq("ativo", true).order("nome") : Promise.resolve({ data: [] }),
    manage ? userOptions() : Promise.resolve([]),
  ]);
  const linhas = (painel ?? []) as MetaLinha[];
  const metas = (cadastro ?? []) as MetaCadastro[];
  const assessores = (assessoresData ?? []).map((a) => ({ value: a.id as string, label: a.nome as string }));
  const fields = metaFields(assessores, usuarios, false);
  const gerais = linhas.filter((m) => m.alvo === "empresa");
  const pessoas = linhas.filter((m) => m.alvo !== "empresa");
  const porPessoa = new Map<string, MetaLinha[]>();
  for (const m of pessoas) porPessoa.set(m.assessor_nome ?? "—", [...(porPessoa.get(m.assessor_nome ?? "—") ?? []), m]);
  const batidas = linhas.filter((m) => m.realizado >= m.valor).length;
  const mesRef = ref.slice(0, 7);
  const navBtn = "inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-surface px-3 text-sm font-semibold hover:bg-surface-2";

  return (
    <>
      <PageHeader
        eyebrow="Metas"
        title="Metas de processos"
        description={`Referência: ${ref.split("-").reverse().join("/")} — metas diárias deste dia, mensais de ${monthLong(mesRef)} e anuais de ${ref.slice(0, 4)}. ${batidas} de ${linhas.length} batida(s).`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/metas/processos?ref=${addDays(`${mesRef}-01`, -1)}`} className={navBtn} aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /> Mês anterior</Link>
            {ref !== hoje && <Link href="/metas/processos" className={navBtn}>Hoje <ChevronRight className="h-4 w-4" /></Link>}
            {can(profile, "clientes.ver_todos") && <LinkButton href="/relatorios/assessores" variant="secondary" size="sm">Relatório por assessor</LinkButton>}
            {manage && <FormDrawerButton action={salvarMetaProcesso} fields={fields} values={{ alvo: "assessor", periodicidade: "mensal", indicador: "processos_novos" }} title="Nova meta" label="Nova meta" variant="accent" width="max-w-lg" />}
          </div>
        }
      />

      {error ? (
        <Card><EmptyState title="Não foi possível carregar as metas" description="Tente novamente em instantes." /></Card>
      ) : linhas.length === 0 ? (
        <Card><EmptyState icon={<Target className="h-6 w-6" />} title="Nenhuma meta ativa" description={manage ? "Cadastre as metas em “Nova meta”." : "A gestão ainda não cadastrou metas."} /></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader icon={<Building2 className="h-4 w-4" />} title="Metas gerais" description="Toda a empresa" />
            <div className="divide-y divide-line px-5">
              {gerais.length ? gerais.map((m) => <MetaProgresso key={m.meta_id} m={m} hoje={hoje} />) : <p className="py-4 text-sm text-muted">Nenhuma meta geral.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader icon={<Users className="h-4 w-4" />} title="Por pessoa" description="Diretoria, assessores, corretores e funcionários dos setores" />
            <div className="divide-y divide-line px-5">
              {[...porPessoa.entries()].map(([nome, ms]) => (
                <div key={nome} className="py-2">
                  <p className="pt-2 text-xs font-bold uppercase tracking-wide text-muted">{nome}</p>
                  {ms.map((m) => <MetaProgresso key={`${m.meta_id}-${m.assessor_id}`} m={m} hoje={hoje} compacto />)}
                </div>
              ))}
              {!porPessoa.size && <p className="py-4 text-sm text-muted">Nenhuma meta individual.</p>}
            </div>
          </Card>
        </div>
      )}

      {manage && (
        <Card className="mt-6">
          <CardHeader icon={<UsersRound className="h-4 w-4" />} title="Metas cadastradas" description="Valem para todo dia, mês ou ano até serem desativadas. Edite para mudar os valores." />
          {metas.length === 0 ? (
            <EmptyState title="Nenhuma meta cadastrada" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Meta</th><th>Mede</th><th>Período</th><th>Para quem</th><th className="text-right">Valor</th><th /></tr></thead>
                <tbody>
                  {metas.map((m) => {
                    const ass = Array.isArray(m.assessores) ? m.assessores[0] : m.assessores;
                    return (
                      <tr key={m.id} className={m.ativo ? "" : "opacity-60"}>
                        <td className="font-medium">{m.nome}{!m.ativo && <Badge tone="slate" className="ml-2">inativa</Badge>}</td>
                        <td className="text-sm">{optionLabel(META_INDICADORES, m.indicador)}</td>
                        <td className="text-sm">{optionLabel(META_PERIODICIDADES, m.periodicidade)}</td>
                        <td className="text-sm">{m.alvo === "empresa" ? "Geral" : m.alvo === "assessor" ? (ass?.nome ?? "—") : m.alvo === "usuario" ? (usuarios.find((u) => u.value === m.usuario_id)?.label ?? "Funcionário") : `Cada ${optionLabel(ASSESSOR_CATEGORIAS, m.categoria ?? "").toLowerCase()}`}</td>
                        <td className="text-right font-semibold tabular-nums">{num(m.valor)}</td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <FormDrawerButton action={salvarMetaProcesso} fields={metaFields(assessores, usuarios, true)} values={{ ...m, assessores: null }} hidden={{ id: m.id }} title="Editar meta" icon="edit" variant="ghost" size="icon" width="max-w-lg" />
                            <ConfirmAction action={excluirMetaProcesso} id={m.id} title="Excluir meta?" message="A meta deixa de aparecer no painel. Para pausar sem perder, edite e desmarque “Meta ativa”." />
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
      )}
      <p className="mt-4 text-xs text-muted">
        Como é medido: processos novos pela data de recebimento e pelo assessor do processo; pendências resolvidas e exigências cumpridas por quem tirou o processo desse status; habilitações pela data de habilitação; judicializados e análises pelo histórico de status; ligações pelas ligações registradas no histórico do cliente pelo usuário do assessor.
        As metas comerciais de consórcio e seguro continuam em <Link href="/metas" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">Metas comerciais</Link>.
      </p>
    </>
  );
}
