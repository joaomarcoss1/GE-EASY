import type { Metadata } from "next";
import { RotateCcw, Trash2 } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { restaurarDaLixeira } from "@/lib/actions/lixeira";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentTabs } from "@/components/ui/filters";
import { ConfirmAction } from "@/components/ui/confirm-action";

export const metadata: Metadata = { title: "Lixeira" };

const TIPOS = [
  { value: "todos", label: "Tudo" },
  { value: "clientes", label: "Clientes" },
  { value: "processos", label: "Processos" },
  { value: "documentos", label: "Documentos" },
  { value: "oportunidades", label: "Oportunidades" },
];

/**
 * Registros excluídos (exclusão lógica). Nada é apagado fisicamente pela aplicação: a exclusão definitiva
 * acontece só pela rotina de retenção ou por pedido do titular (LGPD), e também fica auditada.
 */
export default async function LixeiraPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("lixeira.gerir");
  const { tipo } = await searchParams;
  const filtro = TIPOS.some((t) => t.value === tipo && t.value !== "todos") ? tipo! : null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lixeira_listar", { p_tabela: filtro });
  const itens = (data ?? []) as { tabela: string; id: string; titulo: string; detalhe: string | null; excluido_em: string; excluido_por: string | null }[];
  return (
    <>
      <PageHeader eyebrow="Sistema" title="Lixeira" description="Clientes, processos, documentos e oportunidades excluídos. Restaure com um clique; a ação fica registrada na auditoria." />
      <Card>
        <div className="border-b border-line p-4"><SegmentTabs param="tipo" options={TIPOS} /></div>
        {error ? <EmptyState title="Não foi possível carregar a lixeira" description={error.message} /> : itens.length === 0 ? (
          <EmptyState icon={<Trash2 className="h-6 w-6" />} title="Lixeira vazia" />
        ) : (
          <div className="overflow-x-auto"><table className="table-base">
            <thead><tr><th>Registro</th><th>Tipo</th><th>Excluído em</th><th>Por</th><th /></tr></thead>
            <tbody>
              {itens.map((i) => (
                <tr key={`${i.tabela}:${i.id}`}>
                  <td><span className="font-medium">{i.titulo}</span>{i.detalhe && <div className="text-xs text-muted">{i.detalhe}</div>}</td>
                  <td><Badge tone="slate">{TIPOS.find((t) => t.value === i.tabela)?.label ?? i.tabela}</Badge></td>
                  <td className="whitespace-nowrap text-xs">{dateTime(i.excluido_em)}</td>
                  <td className="text-sm">{i.excluido_por ?? "—"}</td>
                  <td className="text-right">
                    <ConfirmAction action={restaurarDaLixeira} id={`${i.tabela}:${i.id}`} danger={false} variant="secondary" size="sm" icon={<RotateCcw className="h-4 w-4" />} label="Restaurar" title="Restaurar registro?" message="O registro volta a aparecer para quem tem acesso a ele." confirmLabel="Restaurar" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
