import type { Metadata } from "next";
import Link from "next/link";
import { Users, Phone, Mail } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { consultorOptions, getProfileMap, pageRange, searchTerm } from "@/lib/data";
import { CLIENTE_STATUS } from "@/lib/constants";
import { maskDocumento, maskPhone, date } from "@/lib/format";
import type { Cliente } from "@/lib/types";
import { createCliente } from "@/lib/actions/clientes";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDrawerButton } from "@/components/ui/form-drawer";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { LinkButton } from "@/components/ui/button";
import { clienteFields } from "./fields";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile } = await requirePermission("clientes.view");
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page);
  const supabase = await createClient();

  let query = supabase.from("clientes").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const q = searchTerm(sp.q);
  if (q) {
    const digits = q.replace(/\D/g, "");
    query = query.or([`nome.ilike.%${q}%`, `email.ilike.%${q}%`, `cidade.ilike.%${q}%`, ...(digits.length >= 3 ? [`documento.ilike.%${digits}%`, `telefone.ilike.%${digits}%`] : [])].join(","));
  }
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.consultor) query = query.eq("consultor_id", sp.consultor);
  const { data, count } = await query;
  const clientes = (data ?? []) as Cliente[];

  const [profiles, consultores] = await Promise.all([getProfileMap(), consultorOptions()]);
  const canTransfer = can(profile.role, "clientes.transfer");
  const canWrite = can(profile.role, "clientes.write");

  return (
    <>
      <PageHeader
        eyebrow="Comercial"
        title="Clientes"
        description="Carteira completa de clientes e leads, com histórico e negócios vinculados."
        actions={
          <>
            {can(profile.role, "relatorios.view") && (
              <LinkButton href="/api/exportar/clientes" variant="secondary" prefetch={false}>
                Exportar CSV
              </LinkButton>
            )}
            {canWrite && <FormDrawerButton action={createCliente} fields={clienteFields(consultores, canTransfer)} values={{ tipo_pessoa: "PF", status: "lead" }} title="Novo cliente" label="Novo cliente" variant="accent" redirectTo="/clientes/:id" defaultOpen={sp.novo === "1"} />}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Nome, CPF/CNPJ, e-mail, telefone…" />
          <FilterSelect param="status" options={CLIENTE_STATUS} allLabel="Todos os status" />
          {canTransfer && <FilterSelect param="consultor" options={consultores} allLabel="Todos os consultores" />}
        </div>
        {clientes.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="Nenhum cliente encontrado" description={sp.q || sp.status ? "Ajuste os filtros para ver mais resultados." : "Cadastre seu primeiro cliente para começar."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Contato</th>
                  <th>Cidade</th>
                  <th>Consultor</th>
                  <th>Status</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => {
                  const consultor = c.consultor_id ? profiles.get(c.consultor_id) : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/clientes/${c.id}`} className="flex items-center gap-3">
                          <Avatar name={c.nome} size={36} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold hover:text-brand-600">{c.nome}</span>
                            <span className="block text-xs text-muted">{c.documento ? maskDocumento(c.documento) : c.tipo_pessoa === "PJ" ? "Pessoa jurídica" : "Pessoa física"}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="text-xs">
                        {c.telefone || c.whatsapp ? <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-muted" />{maskPhone(c.whatsapp || c.telefone)}</div> : null}
                        {c.email ? <div className="mt-0.5 flex items-center gap-1.5 text-muted"><Mail className="h-3.5 w-3.5" />{c.email}</div> : null}
                      </td>
                      <td className="text-sm">{c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ""}` : <span className="text-muted">—</span>}</td>
                      <td className="text-sm">{consultor?.full_name ?? <span className="text-muted">—</span>}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <StatusBadge options={CLIENTE_STATUS} value={c.status} />
                          {c.tags.slice(0, 2).map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
                        </div>
                      </td>
                      <td className="text-xs text-muted">{date(c.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pageSize={size} total={count ?? 0} />
      </Card>
    </>
  );
}
