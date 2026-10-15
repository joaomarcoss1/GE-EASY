import type { Metadata } from "next";
import { Copy, FileSignature, Wand2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can, isManagerRole } from "@/lib/rbac";
import { getProfileMap, searchTerm } from "@/lib/data";
import { MODELO_CATEGORIAS, PROCESSO_AREAS } from "@/lib/constants";
import { date } from "@/lib/format";
import type { ModeloDocumento } from "@/lib/types";
import { deleteModelo, duplicarModelo, saveModelo } from "@/lib/actions/modelos";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, optionLabel } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterSelect, SearchInput } from "@/components/ui/filters";
import { ModeloEditor } from "@/components/modelos/editor";

export const metadata: Metadata = { title: "Modelos de documentos" };

export default async function ModelosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { profile, userId } = await requirePermission("modelos.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("modelos_documentos").select("*").order("categoria").order("titulo").limit(500);
  if (sp.cat) query = query.eq("categoria", sp.cat);
  if (sp.area) query = query.eq("area", sp.area);
  if (sp.inativos !== "1") query = query.eq("ativo", true);
  const q = searchTerm(sp.q);
  if (q) query = query.or(`titulo.ilike.%${q}%,descricao.ilike.%${q}%`);
  const [{ data }, profiles] = await Promise.all([query, getProfileMap()]);
  const modelos = (data ?? []) as ModeloDocumento[];
  const canWrite = can(profile.role, "modelos.write");
  const manager = isManagerRole(profile.role);
  const qs = [sp.cliente_id && `cliente_id=${sp.cliente_id}`, sp.processo_id && `processo_id=${sp.processo_id}`, sp.contrato_id && `contrato_id=${sp.contrato_id}`].filter(Boolean).join("&");

  return (
    <>
      <PageHeader
        eyebrow="Jurídico"
        title="Modelos de documentos"
        description="Petições, procurações, contratos e declarações preenchidos automaticamente com os dados do cliente e do processo."
        actions={canWrite && <ModeloEditor action={saveModelo} />}
      />
      <Card className="mb-6">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Buscar modelo…" />
          <FilterSelect param="cat" options={MODELO_CATEGORIAS} allLabel="Todas as categorias" />
          <FilterSelect param="area" options={PROCESSO_AREAS} allLabel="Todas as áreas" />
          <FilterSelect param="inativos" options={[{ value: "1", label: "Incluir inativos" }]} allLabel="Somente ativos" />
        </div>
      </Card>
      {modelos.length === 0 ? (
        <Card>
          <EmptyState icon={<FileSignature className="h-6 w-6" />} title="Nenhum modelo encontrado" description="Crie modelos com campos automáticos como {{cliente.nome}} e gere documentos prontos em segundos." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {modelos.map((m) => {
            const editable = canWrite && (manager || m.created_by === userId);
            return (
              <Card key={m.id} className={`flex flex-col p-5 ${m.ativo ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
                    <FileSignature className="h-5 w-5" />
                  </div>
                  <div className="flex gap-1">
                    {editable && <ModeloEditor action={saveModelo} values={{ ...m }} />}
                    {canWrite && <ConfirmAction action={duplicarModelo} id={m.id} title="Duplicar modelo?" message="Será criada uma cópia editável." confirmLabel="Duplicar" danger={false} icon={<Copy className="h-4 w-4" />} label="Duplicar" />}
                    {editable && <ConfirmAction action={deleteModelo} id={m.id} title="Excluir modelo?" />}
                  </div>
                </div>
                <h3 className="mt-3 font-semibold">{m.titulo}</h3>
                {m.descricao && <p className="mt-1 text-sm text-muted">{m.descricao}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="brand">{optionLabel(MODELO_CATEGORIAS, m.categoria)}</Badge>
                  {m.area && <Badge tone="slate">{optionLabel(PROCESSO_AREAS, m.area)}</Badge>}
                  {!m.ativo && <Badge tone="amber">Inativo</Badge>}
                </div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap font-serif text-xs text-muted">{m.conteudo.slice(0, 280)}</p>
                <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted">
                  <span>{m.created_by ? profiles.get(m.created_by)?.full_name : "Modelo padrão"} · {date(m.updated_at)}</span>
                  <LinkButton href={`/modelos/gerar?modelo_id=${m.id}${qs ? `&${qs}` : ""}`} size="sm">
                    <Wand2 className="h-4 w-4" /> Gerar
                  </LinkButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
