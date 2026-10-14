"use client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/40"><AlertTriangle className="h-6 w-6" /></div>
      <h2 className="mt-4 text-lg font-semibold">Algo deu errado</h2>
      <p className="mt-1 text-sm text-muted">Não foi possível carregar esta página. {error.digest && <span className="block text-xs">Código: {error.digest}</span>}</p>
      <Button className="mt-6" onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
