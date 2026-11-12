import type { Metadata } from "next";
import { Database } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { consultorOptions, getProfileMap, pageRange, searchTerm } from "@/lib/data";
import { CADASTRO_STATUS, CARTEIRAS, CASO_STATUS, ORIGENS } from "@/lib/constants";
import { filtrosNome } from "@/lib/casos";
import { date, maskDocumento, maskPhone, whatsappLink } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { importarClientes } from "@/lib/actions/conta";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { BaseTabela, type LinhaBase } from "@/components/clientes/base-tabela";

export const metadata: Metadata = { title: "Base de clientes" };

interface BaseRow {
  id: string; nome: string; documento: string | null; telefone: string | null; whatsapp: string | null; cidade: string | null; uf: string | null;
  carteira: string; status_cadastro: string; consultor_id: string | null; responsavel_admin_id: string | null; prazo_documentacao: string | null; origem: string | null;
}

/** Base completa da empresa (clientes.ver_todos): filtros por carteira, situação, consultor, cidade e origem; redistribuição em lote. */
export default async function BaseClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.ver_todos");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page, 50);
  const supabase = await createClient();
  // filtros pelos processos do cliente (situação, tipo e consultor da planilha)
  const pStatus = CASO_STATUS.some((o) => o.value === sp.processo) ? sp.processo : null;
  const pTipo = sp.tipo?.trim().slice(0, 80) || null;
  const pCorretor = sp.corretor?.trim().slice(0, 80).toUpperCase() || null;
  const filtraCaso = !!(pStatus || pTipo || pCorretor);
  let q = supabase
    .from("clientes")
    .select(`id, nome, documento, telefone, whatsapp, cidade, uf, carteira, status_cadastro, consultor_id, responsavel_admin_id, prazo_documentacao, origem${filtraCaso ? ", cliente_casos!inner(status, tipo, corretores)" : ""}`, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);
  const termo = searchTerm(sp.q);
  if (termo) {
    // nome sem acento e com as palavras em qualquer ordem; só números = CPF
    const { dig, palavras } = filtrosNome(termo);
    if (dig && !palavras.length) q = q.ilike("documento", `%${dig}%`);
    else for (const w of palavras) q = q.ilike("nome_busca", `%${w}%`);
  }
  if (sp.carteira && CARTEIRAS.some((o) => o.value === sp.carteira)) q = q.eq("carteira", sp.carteira);
  if (sp.cadastro && CADASTRO_STATUS.some((o) => o.value === sp.cadastro)) q = q.eq("status_cadastro", sp.cadastro);
  if (sp.consultor && /^[0-9a-f-]{36}$/i.test(sp.consultor)) q = q.eq("consultor_id", sp.consultor);
  if (sp.origem && ORIGENS.some((o) => o.value === sp.origem)) q = q.eq("origem", sp.origem);
  if (sp.cidade) q = q.ilike("cidade", sp.cidade.slice(0, 80).replace(/[%_]/g, ""));
  if (pStatus) q = q.eq("cliente_casos.status", pStatus);
  if (pTipo) q = q.eq("cliente_casos.tipo", pTipo);
  if (pCorretor) q = q.contains("cliente_casos.corretores", [pCorretor]);
  const [{ data, count }, nomes, consultores, { data: opData }] = await Promise.all([q, getProfileMap(), consultorOptions(), supabase.rpc("cliente_casos_opcoes")]);
  const op = (opData ?? { tipos: [], cidades: [], corretores: [] }) as { tipos: string[]; cidades: string[]; corretores: string[] };
  const lista = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));
  const linhas: LinhaBase[] = ((data ?? []) as unknown as BaseRow[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    documento: c.documento ? maskDocumento(c.documento) : "",
    cidade: c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : "—",
    carteira: c.carteira,
    status_cadastro: c.status_cadastro,
    responsavel: (c.consultor_id && nomes.get(c.consultor_id)?.full_name) || (c.responsavel_admin_id && nomes.get(c.responsavel_admin_id)?.full_name) || "—",
    prazo: c.prazo_documentacao ? date(c.prazo_documentacao) : "—",
    telefone: maskPhone(c.whatsapp || c.telefone),
    whatsapp: whatsappLink(c.whatsapp || c.telefone),
  }));

  return (
    <>
      <PageHeader
        eyebrow="Administrativo"
        title="Base de clientes"
        description="Todos os clientes da empresa. Selecione para redistribuir entre consultores ou para a base administrativa."
        actions={
          <>
            {can(profile, "clientes.write") && can(profile, "clientes.ver_todos") && (
              <FormDrawerButton action={importarClientes} title="Importar clientes (CSV)" label="Importar CSV" icon="none" variant="secondary" submitLabel="Importar"
                description="Primeira linha com os nomes das colunas: nome, cpf, telefone, whatsapp, email, endereco, bairro, cidade, uf, origem, tags (separadas por |), observacoes. Separador ; ou ,. CPF/CNPJ já cadastrados são ignorados."
                fields={[{ name: "arquivo", label: "Arquivo CSV (até 5 MB, 5.000 linhas)", type: "file", placeholder: ".csv,text/csv", required: true, span: 6 }]} />
            )}
            {can(profile, "clientes.exportar") && <LinkButton href="/api/exportar/clientes" variant="secondary" prefetch={false}>Exportar CSV</LinkButton>}
          </>
        }
      />
      <Card>
        <div className="flex flex-col flex-wrap gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Nome, CPF/CNPJ ou cidade…" />
          <FilterSelect param="carteira" options={CARTEIRAS} allLabel="Todas as carteiras" />
          <FilterSelect param="cadastro" options={CADASTRO_STATUS} allLabel="Toda situação" />
          <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" />
          <FilterSelect param="origem" options={ORIGENS} allLabel="Todas as origens" />
          <FilterSelect param="cidade" options={lista(op.cidades)} allLabel="Todas as cidades" />
          <FilterSelect param="processo" options={CASO_STATUS} allLabel="Situação do processo" />
          <FilterSelect param="tipo" options={lista(op.tipos)} allLabel="Tipo de processo" />
          <FilterSelect param="corretor" options={lista(op.corretores)} allLabel="Consultor da planilha" />
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
