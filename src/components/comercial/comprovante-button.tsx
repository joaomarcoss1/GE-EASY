"use client";
import { useTransition } from "react";
import { FileText, Loader2 } from "lucide-react";
import { urlComprovanteAssessor } from "@/lib/actions/comercial";
import { useToast } from "@/components/ui/toast";

/** Abre o comprovante de residência do assessor por um link temporário. */
export function ComprovanteButton({ assessorId }: { assessorId: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <button type="button" disabled={pending} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
      onClick={() => start(async () => {
        const r = await urlComprovanteAssessor(assessorId);
        if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
        else toast(r.error ?? "Indisponível.", "error");
      })}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Ver
    </button>
  );
}
