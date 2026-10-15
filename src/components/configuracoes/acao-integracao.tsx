"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Botão que executa uma Server Action sem parâmetros e mostra o resultado. */
export function AcaoIntegracao({ action, label, variant = "secondary" }: { action: () => Promise<ActionState>; label: string; variant?: "secondary" | "accent" }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          toast(r.ok ? (r.message ?? "Concluído.") : (r.error ?? "Erro."), r.ok ? "success" : "error");
          router.refresh();
        })
      }
    >
      {label}
    </Button>
  );
}
