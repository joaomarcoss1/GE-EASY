"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Pencil } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "./button";
import { Drawer } from "./drawer";
import { ResourceForm, type FieldDef, type Values } from "./form";

/**
 * Botão que abre um painel lateral com formulário. Após salvar, fecha e
 * atualiza a página (ou redireciona para `redirectTo(id)`).
 */
export function FormDrawerButton({
  action,
  fields,
  values,
  hidden,
  title,
  description,
  label,
  icon = "plus",
  variant = "primary",
  size = "md",
  submitLabel,
  redirectTo,
  width,
  defaultOpen = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  values?: Values;
  hidden?: Values;
  title: string;
  description?: string;
  label?: string;
  icon?: "plus" | "edit" | "key" | "none";
  variant?: "primary" | "accent" | "secondary" | "ghost" | "outline";
  size?: "sm" | "md" | "icon";
  submitLabel?: string;
  redirectTo?: string;
  width?: string;
  /** Abre automaticamente (ex.: link "?novo=1" vindo de outra tela) */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();
  const onSuccess = useCallback(
    (s: ActionState) => {
      setOpen(false);
      if (redirectTo && s.id) router.push(redirectTo.replace(":id", s.id));
      else router.refresh();
    },
    [router, redirectTo],
  );
  const Icon = icon === "plus" ? Plus : icon === "edit" ? Pencil : icon === "key" ? KeyRound : null;
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)} aria-label={label ?? title} title={size === "icon" ? title : undefined}>
        {Icon && <Icon className="h-4 w-4" />}
        {size !== "icon" && (label ?? title)}
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={title} description={description} width={width}>
        {open && <ResourceForm action={action} fields={fields} values={values} hidden={hidden} submitLabel={submitLabel} onSuccess={onSuccess} />}
      </Drawer>
    </>
  );
}
