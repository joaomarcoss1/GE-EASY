"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "./button";
import { Modal } from "./drawer";
import { useToast } from "./toast";

/** Executa uma Server Action (ex.: excluir) após confirmação. */
export function ConfirmAction({
  action,
  id,
  title = "Confirmar exclusão",
  message = "Esta ação não pode ser desfeita.",
  confirmLabel = "Excluir",
  label,
  variant = "ghost",
  size = "icon",
  redirectTo,
  icon,
  danger = true,
}: {
  action: (id: string) => Promise<ActionState>;
  id: string;
  title?: string;
  message?: string;
  confirmLabel?: string;
  label?: string;
  variant?: "ghost" | "danger" | "secondary" | "outline" | "primary";
  size?: "sm" | "md" | "icon";
  redirectTo?: string;
  icon?: React.ReactNode;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} aria-label={label ?? title} title={label ?? title} className={danger && variant === "ghost" ? "hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/40" : undefined}>
        {icon ?? <Trash2 className="h-4 w-4" />}
        {size !== "icon" && label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <p className="text-sm text-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await action(id);
                if (r.ok) {
                  toast(r.message ?? "Concluído.");
                  setOpen(false);
                  if (redirectTo) router.push(redirectTo);
                  else router.refresh();
                } else toast(r.error ?? "Não foi possível concluir.", "error");
              })
            }
          >
            {confirmLabel}
          </Button>
        </div>
      </Modal>
    </>
  );
}
