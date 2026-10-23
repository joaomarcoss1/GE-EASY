import type { Metadata } from "next";
import { Database } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { consultorOptions, getProfileMap, pageRange, searchTerm } from "@/lib/data";
import { CADASTRO_STATUS, CARTEIRAS, ORIGENS } from "@/lib/constants";
import { date, maskDocumento } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { BaseTabela, type LinhaBase } from "@/components/clientes/base-tabela";

export const metadata: Metadata = { title: "Base de clientes" };

/** Base completa da empresa (clientes.ver_todos): filtros por carteira, situação, consultor, cidade e origem; redistribuição em lote. */
export default async function BaseClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.ver_todos");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page, 50);
  const supabase = await createClient();
  let q = supabase
    .from("clientes")
    .select("id, nome, documento, cidade, uf, carteira, status_cadastro, consultor_id, responsavel_admin_id, prazo_documentacao, origem", { count: "estimated" })
    .order("updated_at", { ascending: false })
    .range(from, to);
  const termo = searchTerm(sp.q);
  if (termo) {
    const dig = termo.replace(/\D/g, "");
    q = q.or([`nome.ilike.%${termo}%`, `cidade.ilike.%${termo}%`, ...(dig.length >= 3 ? [`documento.ilike.%${dig}%`] : [])].join(","));
  }
  if (sp.carteira && CARTEIRAS.some((o) => o.value === sp.carteira)) q = q.eq("carteira", sp.carteira);
  if (sp.cadastro && CADASTRO_STATUS.some((o) => o.value === sp.cadastro)) q = q.eq("status_cadastro", sp.cadastro);
  if (sp.consultor && /^[0-9a-f-]{36}$/i.test(sp.consultor)) q = q.eq("consultor_id", sp.consultor);
  if (sp.origem && ORIGENS.some((o) => o.value === sp.origem)) q = q.eq("origem", sp.origem);
  const [{ data, count }, nomes, consultores] = await Promise.all([q, getProfileMap(), consultorOptions()]);
  const linhas: LinhaBase[] = (data ?? []).map((c) => ({
    id: c.id,
    nome: c.nome,
    documento: c.documento ? maskDocumento(c.documento) : "",
    cidade: c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : "—",
    carteira: c.carteira,
    status_cadastro: c.status_cadastro,
    responsavel: (c.consultor_id && nomes.get(c.consultor_id)?.full_name) || (c.responsavel_admin_id && nomes.get(c.responsavel_admin_id)?.full_name) || "—",
    prazo: c.prazo_documentacao ? date(c.prazo_documentacao) : "—",
  }));

  return (
    <>
      <PageHeader
        eyebrow="Administrativo"
        title="Base de clientes"
        description="Todos os clientes da empresa. Selecione para redistribuir entre consultores ou para a base administrativa."
        actions={can(profile, "clientes.exportar") && <LinkButton href="/api/exportar/clientes" variant="secondary" prefetch={false}>Exportar CSV</LinkButton>}
      />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Nome, CPF/CNPJ ou cidade…" />
          <FilterSelect param="carteira" options={CARTEIRAS} allLabel="Todas as carteiras" />
          <FilterSelect param="cadastro" options={CADASTRO_STATUS} allLabel="Toda situação" />
          <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" />
          <FilterSelect param="origem" options={ORIGENS} allLabel="Todas as origens" />
        </div>
        {linhas.length === 0 ? (
          <EmptyState icon={<Database className="h-6 w-6" />} title="Nenhum cliente encontrado" />
        ) : (
          <BaseTabela linhas={linhas} consultores={consultores} podeRedistribuir={can(profile, "clientes.transfer")} />
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}
