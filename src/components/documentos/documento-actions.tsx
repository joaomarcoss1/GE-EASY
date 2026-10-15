"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, HardDrive, Loader2 } from "lucide-react";
import { deleteDocumento, getDownloadUrl, sendToDrive } from "@/lib/actions/documentos";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { useToast } from "@/components/ui/toast";

const safeDriveUrl = (u: string | null) => (u && /^https:\/\/(drive|docs)\.google\.com\//.test(u) ? u : null);

/** Ações de um documento: baixar (URL assinada de 60 s), enviar/abrir no Drive e excluir. */
export function DocumentoActions({ id, nome, driveUrl, canDelete, googleReady }: { id: string; nome: string; driveUrl: string | null; canDelete: boolean; googleReady: boolean }) {
  const [downloading, startDownload] = useTransition();
  const [sending, startSend] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const drive = safeDriveUrl(driveUrl);

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Baixar"
        aria-label={`Baixar ${nome}`}
        disabled={downloading}
        onClick={() =>
          startDownload(async () => {
            const r = await getDownloadUrl(id);
            if (r.ok && r.url) window.location.assign(r.url);
            else toast(r.error ?? "Não foi possível baixar.", "error");
          })
        }
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </Button>

      {drive ? (
        <a href={drive} target="_blank" rel="noopener noreferrer" title="Abrir no Google Drive" aria-label={`Abrir ${nome} no Google Drive`} className="grid h-9 w-9 place-items-center rounded-xl text-emerald-600 hover:bg-surface-2">
          <ExternalLink className="h-4 w-4" />
        </a>
      ) : googleReady ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Arquivar no Drive do escritório"
          aria-label={`Arquivar ${nome} no Drive do escritório`}
          disabled={sending}
          onClick={() =>
            startSend(async () => {
              const r = await sendToDrive(id);
              if (r.ok) {
                toast(r.message ?? "Arquivado no Drive.");
                router.refresh();
              } else toast(r.error ?? "Falha ao enviar ao Drive.", "error");
            })
          }
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
        </Button>
      ) : (
        <Link href="/configuracoes?tab=integracoes" title="Defina o Drive do escritório em Configurações › Integrações" aria-label="Configurar Drive do escritório" className="grid h-9 w-9 place-items-center rounded-xl text-muted/60 hover:bg-surface-2 hover:text-fg">
          <HardDrive className="h-4 w-4" />
        </Link>
      )}

      {canDelete && <ConfirmAction action={deleteDocumento} id={id} title="Excluir documento?" message={`"${nome}" será removido do sistema. Cópias já enviadas ao Google Drive não são apagadas.`} />}
    </div>
  );
}
