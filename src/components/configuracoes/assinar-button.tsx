"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** Executa a ação de cobrança e abre o link de pagamento da Asaas (boleto, PIX ou cartão) em nova aba. */
export function AssinarButton({ action, label, variant = "primary" }: { action: () => Promise<ActionState & { url?: string }>; label: string; variant?: "primary" | "secondary" | "outline" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <Button type="button" size="sm" variant={variant} loading={pending}
      onClick={() => start(async () => {
        const r = await action();
        if (r.url) window.open(r.url, "_blank", "noopener");
        if (r.ok) {
          toast(r.message ?? "Concluído.");
          router.refresh();
        } else toast(r.error ?? "Não foi possível concluir.", "error");
      })}>
      {label}
    </Button>
  );
}
