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
import { getGoogleStatus } from "./google-status";

/** Painel de documentos do cliente: envio (drag & drop) + lista com download, Drive e exclusão. */
export async function DocumentosPanel({ clienteId }: { clienteId: string }) {
  const session = await getSession();
  if (!session?.profile.active) return null;
  const supabase = await createClient();
  const [{ data }, profiles, google] = await Promise.all([
    supabase.from("documentos").select("*").eq("cliente_id", clienteId).order("created_at", { ascending: false }).limit(200),
    getProfileMap(),
    getGoogleStatus(),
  ]);
  const docs = (data ?? []) as Documento[];
  const googleReady = google.configured && google.connected;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Enviar documentos"
          description="Armazenamento privado: os downloads usam links temporários de 60 segundos."
          icon={<FolderOpen className="h-4 w-4" />}
          action={
            googleReady ? (
              <span className="hidden items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 sm:flex">
                <HardDrive className="h-3.5 w-3.5" /> Drive conectado{google.email ? ` · ${google.email}` : ""}
              </span>
            ) : (
              <Link href="/configuracoes?tab=integracoes" className="hidden text-xs font-medium text-brand-600 hover:underline sm:block">
                Conectar Google Drive
              </Link>
            )
          }
        />
        <CardBody>
          <DocumentUploader clienteId={clienteId} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Documentos do cliente" description={`${docs.length} arquivo(s)`} />
        {docs.length === 0 ? (
          <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="Nenhum documento ainda" description="Envie RG/CNH, comprovantes, contratos e apólices para manter tudo organizado." />
        ) : (
          <DocumentosTable docs={docs} profiles={profiles} currentUserId={session.userId} isManager={isManagerRole(session.profile.role)} googleReady={googleReady} />
        )}
      </Card>
    </div>
  );
}
