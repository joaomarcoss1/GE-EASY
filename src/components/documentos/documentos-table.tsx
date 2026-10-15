import Link from "next/link";
import { File, FileImage, FileSpreadsheet, FileText, FileType } from "lucide-react";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { dateTime } from "@/lib/format";
import type { Documento } from "@/lib/types";
import { Badge, optionLabel } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { DocumentoActions } from "./documento-actions";
import { docKind, formatBytes, type DocKind } from "./mime";

const KIND: Record<DocKind, { icon: typeof File; cls: string; label: string }> = {
  pdf: { icon: FileText, cls: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300", label: "PDF" },
  image: { icon: FileImage, cls: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300", label: "Imagem" },
  sheet: { icon: FileSpreadsheet, cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300", label: "Planilha" },
  word: { icon: FileType, cls: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200", label: "Word" },
  text: { icon: FileText, cls: "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300", label: "Texto" },
  other: { icon: File, cls: "bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300", label: "Arquivo" },
};

export function DocIcon({ mime, className }: { mime: string | null; className?: string }) {
  const k = KIND[docKind(mime)];
  return (
    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", k.cls, className)} title={k.label}>
      <k.icon className="h-5 w-5" />
    </span>
  );
}

export type DocumentoRow = Documento & { cliente_nome?: string | null };

/** Lista de documentos (servidor) com ações de cliente. */
export function DocumentosTable({
  docs,
  profiles,
  currentUserId,
  isManager,
  googleReady,
  showCliente = false,
}: {
  docs: DocumentoRow[];
  profiles: Map<string, { full_name: string }>;
  currentUserId: string;
  isManager: boolean;
  googleReady: boolean;
  showCliente?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Documento</th>
            {showCliente && <th>Cliente</th>}
            <th>Categoria</th>
            <th>Enviado por</th>
            <th>Data</th>
            <th className="text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>
                <div className="flex min-w-[220px] items-center gap-3">
                  <DocIcon mime={d.mime_type} />
                  <span className="min-w-0">
                    <span className="block max-w-[320px] truncate font-semibold" title={d.nome}>
                      {d.nome}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      {d.tamanho ? formatBytes(d.tamanho) : d.mime_type === "application/vnd.google-apps.document" ? "Google Docs" : formatBytes(d.tamanho)}
                      {d.drive_url ? (
                        <Badge tone="green" className="!px-1.5 !py-0 text-[10px]">
                          No Drive
                        </Badge>
                      ) : d.drive_status === "erro" && googleReady ? (
                        <Badge tone="red" className="!px-1.5 !py-0 text-[10px]">
                          Falha no Drive
                        </Badge>
                      ) : d.drive_status === "pendente" && googleReady ? (
                        <Badge tone="amber" className="!px-1.5 !py-0 text-[10px]">
                          Arquivando…
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </div>
              </td>
              {showCliente && (
                <td className="text-sm">
                  {d.cliente_id ? (
                    <Link href={`/clientes/${d.cliente_id}?tab=documentos`} className="font-medium hover:text-brand-600">
                      {d.cliente_nome ?? "Cliente"}
                    </Link>
                  ) : (
                    <span className="text-muted">Geral</span>
                  )}
                </td>
              )}
              <td>
                <Badge tone="brand">{optionLabel(DOC_CATEGORIAS, d.categoria)}</Badge>
              </td>
              <td className="text-sm">{(d.enviado_por && profiles.get(d.enviado_por)?.full_name) || <span className="text-muted">—</span>}</td>
              <td className="whitespace-nowrap text-xs text-muted">{dateTime(d.created_at)}</td>
              <td>
                <DocumentoActions id={d.id} nome={d.nome} driveUrl={d.drive_url} canDelete={isManager || d.enviado_por === currentUserId} googleReady={googleReady} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
