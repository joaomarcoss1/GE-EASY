"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "./button";
import { useToast } from "./toast";

/** Botão que executa uma Server Action sem formulário (aprovar, otimizar, revisar...) e atualiza a tela. */
export function ActionButton({
  action,
  label,
  variant = "secondary",
  size = "sm",
  icon,
  disabled,
  title,
}: {
  action: () => Promise<ActionState>;
  label: string;
  variant?: "primary" | "accent" | "secondary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  icon?: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      loading={pending}
      disabled={disabled}
      title={title}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r.ok) {
            toast(r.message ?? "Concluído.");
            router.refresh();
          } else toast(r.error ?? "Não foi possível concluir.", "error");
        })
      }
    >
      {icon}
      {label}
    </Button>
  );
}
