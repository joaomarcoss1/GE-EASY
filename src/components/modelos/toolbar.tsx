"use client";
import { useTransition } from "react";
import { ClipboardCopy, Download, NotebookPen, Printer } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const sanitize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "documento";

/** Ações do documento gerado: imprimir/PDF, baixar .doc, copiar texto, registrar no processo. */
export function DocumentoToolbar({
  titulo,
  html,
  texto,
  registrar,
}: {
  titulo: string;
  html: string;
  texto: string;
  registrar?: () => Promise<ActionState>;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const baixarDoc = () => {
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${titulo.replace(/</g, "")}</title>
<style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5} .doc{white-space:pre-wrap} mark{background:#fde68a}</style></head><body><div class="doc">${html}</div></body></html>`;
    const blob = new Blob(["﻿", doc], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitize(titulo)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Imprimir / salvar PDF
      </Button>
      <Button variant="secondary" onClick={baixarDoc}>
        <Download className="h-4 w-4" /> Baixar .doc (Word)
      </Button>
      <Button
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto);
            toast("Texto copiado.");
          } catch {
            toast("Não foi possível copiar.", "error");
          }
        }}
      >
        <ClipboardCopy className="h-4 w-4" /> Copiar texto
      </Button>
      {registrar && (
        <Button
          variant="outline"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await registrar();
              toast(r.ok ? (r.message ?? "Registrado.") : (r.error ?? "Erro."), r.ok ? "success" : "error");
            })
          }
        >
          <NotebookPen className="h-4 w-4" /> Registrar no processo
        </Button>
      )}
    </div>
  );
}
