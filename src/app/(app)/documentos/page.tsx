import type { Metadata } from "next";
import { Suspense } from "react";
import { FolderOpen, HardDrive, Files, UploadCloud } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { clienteOptions, getProfileMap, pageRange, searchTerm } from "@/lib/data";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { isManagerRole } from "@/lib/rbac";
import type { Documento } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { FilterSelect, Pagination, SearchInput } from "@/components/ui/filters";
import { DocumentosTable, type DocumentoRow } from "@/components/documentos/documentos-table";
import { ClientePicker } from "@/components/documentos/cliente-picker";
import { getGoogleStatus } from "@/components/documentos/google-status";

export const metadata: Metadata = { title: "Documentos" };

export default async function DocumentosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const { page, size, from, to } = pageRange(sp.page, 25);
  const supabase = await createClient();

  let query = supabase.from("documentos").select("*, clientes(nome)", { count: "estimated" }).order("created_at", { ascending: false }).range(from, to);
  const q = searchTerm(sp.q);
  if (q) query = query.ilike("nome", `%${q}%`);
  const categoria = DOC_CATEGORIAS.some((c) => c.value === sp.categoria) ? sp.categoria : undefined;
  if (categoria) query = query.eq("categoria", categoria);

  const [{ data, count }, { count: totalDocs }, { count: naDrive }, profiles, clientes, google] = await Promise.all([
    query,
    supabase.from("documentos").select("id", { count: "exact", head: true }),
    supabase.from("documentos").select("id", { count: "exact", head: true }).not("drive_url", "is", null),
    getProfileMap(),
    clienteOptions(),
    getGoogleStatus(),
  ]);

  const docs: DocumentoRow[] = (data ?? []).map((d) => {
    const rel = (d as { clientes?: { nome: string } | { nome: string }[] | null }).clientes;
    return { ...(d as Documento), cliente_nome: (Array.isArray(rel) ? rel[0]?.nome : rel?.nome) ?? null };
  });
  const googleReady = google.configured && google.connected;

  return (
    <>
      <PageHeader eyebrow="Gestão" title="Documentos" description="Todos os documentos de clientes que você pode acessar, com download seguro e envio ao Google Drive." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Documentos" value={totalDocs ?? 0} icon={<Files className="h-5 w-5" />} hint="Visíveis para você" />
        <StatCard label="Enviados ao Drive" value={naDrive ?? 0} icon={<HardDrive className="h-5 w-5" />} tone="green" hint={googleReady ? `Conectado${google.email ? ` · ${google.email}` : ""}` : "Google Drive não conectado"} />
        <StatCard label="Clientes na carteira" value={clientes.length} icon={<FolderOpen className="h-5 w-5" />} tone="accent" hint="Escolha um para enviar arquivos" />
      </div>

      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-200">
              <UploadCloud className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Enviar novos documentos</p>
              <p className="text-xs text-muted">O envio é feito na ficha do cliente, para que cada arquivo fique vinculado à carteira certa.</p>
            </div>
          </div>
          <ClientePicker options={clientes} />
        </CardBody>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <Suspense>
            <SearchInput placeholder="Buscar pelo nome do arquivo…" />
            <FilterSelect param="categoria" options={DOC_CATEGORIAS} allLabel="Todas as categorias" />
          </Suspense>
        </div>
        {docs.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-6 w-6" />}
            title="Nenhum documento encontrado"
            description={q || categoria ? "Ajuste a busca ou o filtro de categoria." : "Abra a ficha de um cliente (acima) e envie os arquivos na aba Documentos."}
          />
        ) : (
          <DocumentosTable docs={docs} profiles={profiles} currentUserId={session.userId} isManager={isManagerRole(session.profile.role)} googleReady={googleReady} showCliente />
        )}
        <Suspense>
          <Pagination page={page} pageSize={size} total={count ?? 0} />
        </Suspense>
      </Card>
    </>
  );
}
