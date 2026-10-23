"use client";
import { Printer } from "lucide-react";
import { Button } from "./button";

/** Imprime a página atual (o navegador oferece "Salvar como PDF"); menus e botões somem na impressão. */
export function PrintButton({ label = "Imprimir / PDF", onPrint }: { label?: string; onPrint?: () => void }) {
  return (
    <Button type="button" variant="secondary" className="no-print" onClick={() => { onPrint?.(); window.print(); }}>
      <Printer className="h-4 w-4" />
      {label}
    </Button>
  );
}
