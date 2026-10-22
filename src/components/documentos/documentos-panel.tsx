import { FolderOpen, HardDrive } from "lucide-react";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfileMap } from "@/lib/data";
import { isManagerRole } from "@/lib/rbac";
import type { Documento } from "@/lib/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentUploader } from "./document-uploader";
import { DocumentosTable } from "./documentos-table";
import { DrivePastaButton } from "./drive-pasta-button";
import { getDriveEscritorioStatus } from "./google-status";

/**
 * Painel de documentos do cliente ou do processo: envio (drag & drop) + lista com download,
 * Drive e exclusão. No processo, lista os documentos do processo; no cliente, todos os do cliente.
 */
export async function DocumentosPanel({ clienteId, processoId, podeEnviar = true }: { clienteId?: string | null; processoId?: string | null; podeEnviar?: boolean }) {
  const session = await getSession();
  if (!session?.profile.active) return null;
  const supabase = await createClient();
  let query = supabase.from("documentos").select("*").order("created_at", { ascending: false }).limit(300);
  query = processoId ? query.eq("processo_id", processoId) : query.eq("cliente_id", clienteId!);
  const [{ data }, profiles, drive] = await Promise.all([query, getProfileMap(), getDriveEscritorioStatus()]);
  const docs = (data ?? []) as Documento[];
  const alvo = processoId ? "processo" : "cliente";

  return (
    <div className="space-y-6">
      {podeEnviar && (
        <Card>
          <CardHeader
            title="Enviar documentos"
            description={
              drive.ativo
                ? `Armazenamento privado + cópia automática no Drive do escritório, na pasta do ${alvo}.`
                : "Armazenamento privado: os downloads usam links temporários de 60 segundos."
            }
            icon={<FolderOpen className="h-4 w-4" />}
            action={
              drive.ativo ? (
                <DrivePastaButton tipo={processoId ? "processo" : "cliente"} id={(processoId ?? clienteId)!} />
              ) : (
                <Link href="/configuracoes?tab=integracoes" className="hidden text-xs font-medium text-brand-600 hover:underline sm:block">
                  Configurar Drive do escritório
                </Link>
              )
            }
          />
          <CardBody>
            <DocumentUploader empresaId={session.empresa!.id} clienteId={processoId ? null : clienteId} processoId={processoId} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title={processoId ? "Documentos do processo" : "Documentos do cliente"}
          description={`${docs.length} arquivo(s)${drive.ativo ? ` · ${docs.filter((d) => d.drive_file_id).length} no Drive` : ""}`}
          icon={drive.ativo ? <HardDrive className="h-4 w-4" /> : undefined}
        />
        {docs.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-6 w-6" />}
            title="Nenhum documento ainda"
            description={processoId ? "Envie petições, decisões, provas e procurações do processo." : "Envie documentos pessoais, contratos e comprovantes do cliente."}
          />
        ) : (
          <DocumentosTable docs={docs} profiles={profiles} currentUserId={session.userId} isManager={isManagerRole(session.profile.role)} googleReady={drive.ativo} />
        )}
      </Card>
    </div>
  );
}
