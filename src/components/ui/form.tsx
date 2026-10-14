"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Option } from "@/lib/constants";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "./button";
import { useToast } from "./toast";

export type FieldType = "text" | "email" | "tel" | "number" | "money" | "percent" | "date" | "datetime-local" | "time" | "select" | "multiselect" | "textarea" | "checkbox" | "hidden" | "password" | "url" | "documento" | "cep" | "cnj";

export interface FieldDef {
  name: string;
  label?: string;
  type?: FieldType;
  options?: Option[];
  required?: boolean;
  placeholder?: string;
  help?: string;
  span?: 1 | 2 | 3 | 4 | 6;
  min?: number;
  max?: number;
  step?: string;
  rows?: number;
  disabled?: boolean;
  emptyOption?: string | false;
  section?: string;
}

export type Values = Record<string, string | number | boolean | string[] | null | undefined>;

export function SubmitButton({ children, variant = "primary", className }: { children: React.ReactNode; variant?: "primary" | "accent" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} className={className}>
      {children}
    </Button>
  );
}

function maskInput(type: FieldType | undefined, value: string) {
  const d = value.replace(/\D/g, "");
  if (type === "documento") {
    if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    return d.slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  if (type === "tel") {
    const t = d.slice(0, 11);
    if (t.length > 10) return t.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
    return t.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").replace(/[-\s()]+$/, "");
  }
  if (type === "cep") return d.slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
  if (type === "cnj") {
    const c = d.slice(0, 20);
    const parts = [c.slice(0, 7), c.slice(7, 9), c.slice(9, 13), c.slice(13, 14), c.slice(14, 16), c.slice(16, 20)];
    const seps = ["", "-", ".", ".", ".", "."];
    return parts.reduce((acc, part, i) => (part ? acc + seps[i] + part : acc), "");
  }
  return value;
}

export function Field({ field, defaultValue, error }: { field: FieldDef; defaultValue?: Values[string]; error?: string }) {
  const id = `f-${field.name}`;
  const t = field.type ?? "text";
  const common = {
    id,
    name: field.name,
    required: field.required,
    disabled: field.disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-err` : undefined,
  } as const;
  const dv = defaultValue === null || defaultValue === undefined || Array.isArray(defaultValue) ? "" : String(defaultValue);

  if (t === "hidden") return <input type="hidden" name={field.name} value={dv} />;

  let control: React.ReactNode;
  if (t === "multiselect") {
    const selected = new Set(Array.isArray(defaultValue) ? defaultValue : []);
    return (
      <fieldset className={spanCls(field.span)}>
        {field.label && <legend className="label">{field.label}</legend>}
        <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-xl border border-line p-2 sm:grid-cols-2">
          {field.options?.length ? (
            field.options.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
                <input type="checkbox" name={`${field.name}[]`} value={o.value} defaultChecked={selected.has(o.value)} className="h-4 w-4 rounded accent-brand-700" />
                <span className="truncate">{o.label}</span>
              </label>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted">Nenhuma opção disponível.</p>
          )}
        </div>
        {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : field.help ? <p className="mt-1 text-xs text-muted">{field.help}</p> : null}
      </fieldset>
    );
  }

  if (t === "select") {
    control = (
      <select {...common} defaultValue={dv} className="input appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23686a88%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[right_0.9rem_center] bg-no-repeat pr-9">
        {field.emptyOption !== false && <option value="">{field.emptyOption ?? "Selecione…"}</option>}
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (t === "textarea") {
    control = <textarea {...common} defaultValue={dv} rows={field.rows ?? 3} placeholder={field.placeholder} className="input resize-y" maxLength={5000} />;
  } else if (t === "checkbox") {
    return (
      <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3.5 py-3 text-sm hover:bg-surface-2", spanCls(field.span))}>
        <input type="checkbox" name={field.name} defaultChecked={defaultValue === true || defaultValue === "true"} className="h-4 w-4 rounded accent-brand-700" />
        <span>
          <span className="font-medium">{field.label}</span>
          {field.help && <span className="block text-xs text-muted">{field.help}</span>}
        </span>
      </label>
    );
  } else {
    const masked = ["documento", "tel", "cep", "cnj"].includes(t);
    const htmlType = t === "money" || t === "percent" ? "text" : masked ? "text" : t;
    control = (
      <div className="relative">
        {t === "money" && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>}
        <input
          {...common}
          type={htmlType}
          defaultValue={masked ? maskInput(t, dv) : t === "money" || t === "percent" ? (dv ? String(dv).replace(".", ",") : "") : dv}
          placeholder={field.placeholder ?? (t === "money" ? "0,00" : t === "percent" ? "0,00" : undefined)}
          min={field.min}
          max={field.max}
          step={field.step}
          inputMode={t === "money" || t === "percent" || t === "number" || masked ? "decimal" : undefined}
          onInput={masked ? (e) => ((e.target as HTMLInputElement).value = maskInput(t, (e.target as HTMLInputElement).value)) : undefined}
          className={cn("input", t === "money" && "pl-10", t === "percent" && "pr-9")}
          autoComplete={t === "password" ? "current-password" : t === "email" ? "email" : "off"}
        />
        {t === "percent" && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>}
      </div>
    );
  }

  return (
    <div className={spanCls(field.span)}>
      {field.label && (
        <label htmlFor={id} className="label">
          {field.label}
          {field.required && <span className="ml-0.5 text-accent-500">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : field.help ? (
        <p className="mt-1 text-xs text-muted">{field.help}</p>
      ) : null}
    </div>
  );
}

function spanCls(span: FieldDef["span"] = 6) {
  return { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" }[span];
}

/**
 * Formulário dirigido por configuração, ligado a uma Server Action.
 * Exibe erros por campo e notifica sucesso via toast.
 */
export function ResourceForm({
  action,
  fields,
  values,
  submitLabel = "Salvar",
  onSuccess,
  footer,
  hidden,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields: FieldDef[];
  values?: Values;
  submitLabel?: string;
  onSuccess?: (state: ActionState) => void;
  footer?: React.ReactNode;
  hidden?: Values;
}) {
  const [state, formAction] = useActionState(action, {});
  const toast = useToast();
  const last = useRef<ActionState | null>(null);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok) {
      toast(state.message ?? "Salvo com sucesso.");
      onSuccess?.(state);
    } else if (state.error && !state.fieldErrors) {
      toast(state.error, "error");
    }
  }, [state, toast, onSuccess]);

  let lastSection: string | undefined;
  return (
    <form action={formAction} className="space-y-5" noValidate>
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v == null ? "" : String(v)} />)}
      {state.error && state.fieldErrors && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4" /> {state.error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
        {fields.map((f) => {
          const header = f.section && f.section !== lastSection ? f.section : null;
          lastSection = f.section ?? lastSection;
          return (
            <FieldWithSection key={f.name} header={header}>
              <Field field={f} defaultValue={values?.[f.name]} error={state.fieldErrors?.[f.name]} />
            </FieldWithSection>
          );
        })}
      </div>
      <div className="sticky bottom-0 -mx-6 flex items-center justify-end gap-2 border-t border-line bg-surface/95 px-6 py-4 backdrop-blur">
        {footer}
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

function FieldWithSection({ header, children }: { header: string | null; children: React.ReactNode }) {
  if (!header) return <>{children}</>;
  return (
    <>
      <div className="pt-2 sm:col-span-6">
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">
          {header}
          <span className="h-px flex-1 bg-line" />
        </div>
      </div>
      {children}
    </>
  );
}
