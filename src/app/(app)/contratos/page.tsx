import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Repeat, Trophy, Wallet } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { clienteOptions, departamentoOptions, getProfileMap, juridicoOptions, processoOptions, searchTerm } from "@/lib/data";
import { CONTRATO_STATUS, CONTRATO_TIPOS } from "@/lib/constants";
import { brl, brlShort, date, todayISO } from "@/lib/format";
import type { ContratoHonorarios } from "@/lib/types";
import { saveContrato } from "@/lib/actions/contratos";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { StatusBadge, optionLabel } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, SearchInput } from "@/components/ui/filters";
import { contratoFields, descricaoHonorarios } from "@/components/financeiro/fields";

export const metadata: Metadata = { title: "Contratos de honorários" };

type Row = ContratoHonorarios & { clientes: { nome: string } | null; processos: { titulo: string; valor_causa: number | null } | null };

export default async function ContratosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("contratos.view");
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase.from("contratos_honorarios").select("*, clientes(nome), processos(titulo, valor_causa)").order("created_at", { ascending: false }).limit(500);
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.tipo) query = query.eq("tipo", sp.tipo);
  const q = searchTerm(sp.q);
  if (q) query = query.or(`titulo.ilike.%${q}%,numero.ilike.%${q}%`);

  const [{ data }, abertosRes, profiles, clientes, processos, departamentos, juridico] = await Promise.all([
    query,
    supabase.from("financeiro_lancamentos").select("valor, contrato_id").eq("tipo", "receita").eq("status", "aberto").not("contrato_id", "is", null).limit(10000),
    getProfileMap(),
    clienteOptions(),
    processoOptions(),
    departamentoOptions(),
    juridicoOptions(),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const ativos = rows.filter((c) => c.status === "ativo");
  const mrr = ativos.filter((c) => c.tipo === "mensal").reduce((a, c) => a + Number(c.valor_mensal ?? 0), 0);
  const aReceber = (abertosRes.data ?? []).reduce((a, l) => a + Number(l.valor), 0);
  const potencial = ativos
    .filter((c) => (c.tipo === "exito" || c.tipo === "misto") && c.processos?.valor_causa)
    .reduce((a, c) => a + (Number(c.processos!.valor_causa) * Number(c.percentual_exito ?? 0)) / 100, 0);

  return (
    <>
      <PageHeader
        eyebrow="Escritório"
        title="Contratos de honorários"
        description="Honorários fixos, mensais, de êxito e por hora — com parcelas no financeiro."
        actions={
          can(profile, "contratos.write") && (
            <FormDrawerButton
              action={saveContrato}
              fields={contratoFields({ clientes, processos, departamentos, juridico })}
              values={{ tipo: "fixo", status: "ativo", parcelas: 1, data_inicio: todayISO(), cliente_id: sp.cliente_id ?? "", processo_id: sp.processo_id ?? "" }}
              title="Novo contrato de honorários"
              label="Novo contrato"
              variant="accent"
              redirectTo="/contratos/:id"
              width="max-w-3xl"
              defaultOpen={sp.novo === "1"}
            />
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Contratos ativos" value={ativos.length} icon={<FileText className="h-5 w-5" />} />
        <StatCard label="Receita mensal recorrente" value={brlShort(mrr)} hint="Contratos mensais ativos" icon={<Repeat className="h-5 w-5" />} tone="green" />
        <StatCard label="Parcelas a receber" value={brlShort(aReceber)} icon={<Wallet className="h-5 w-5" />} tone="accent" />
        <StatCard label="Êxito potencial" value={brlShort(potencial)} hint="% × valor da causa" icon={<Trophy className="h-5 w-5" />} tone="amber" />
      </div>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Objeto ou nº do contrato…" />
          <FilterSelect param="tipo" options={CONTRATO_TIPOS} allLabel="Todas as modalidades" />
          <FilterSelect param="status" options={CONTRATO_STATUS} allLabel="Todas as situações" />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title="Nenhum contrato" description="Cadastre o contrato de honorários do cliente para gerar as parcelas no financeiro." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Contrato</th>
                  <th>Cliente</th>
                  <th>Honorários</th>
                  <th>Vigência</th>
                  <th>Responsável</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="max-w-[280px]">
                      <Link href={`/contratos/${c.id}`} className="block truncate font-semibold hover:text-brand-600">{c.titulo}</Link>
                      <span className="text-xs text-muted">{c.numero ? `Nº ${c.numero} · ` : ""}{optionLabel(CONTRATO_TIPOS, c.tipo)}</span>
                    </td>
                    <td className="text-sm">{c.clientes?.nome ?? "—"}</td>
                    <td className="max-w-[260px] text-xs">{descricaoHonorarios({ ...c, valor_fixo: c.valor_fixo, valor_mensal: c.valor_mensal })}</td>
                    <td className="text-xs">{date(c.data_inicio)}{c.data_fim ? ` → ${date(c.data_fim)}` : ""}</td>
                    <td className="text-sm">{c.responsavel_id ? profiles.get(c.responsavel_id)?.full_name : "—"}</td>
                    <td><StatusBadge options={CONTRATO_STATUS} value={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-5 py-3 text-xs text-muted">{rows.length} contrato(s) · total de parcelas em aberto {brl(aReceber)}</div>
      </Card>
    </>
  );
}
