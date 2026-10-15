"use client";
import { useCallback, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Calculator, ChevronDown, Plus } from "lucide-react";
import type { ActionState } from "@/lib/actions/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { ResourceForm, type FieldDef, type Values } from "@/components/ui/form";
import { Calculadora, type CalculoResultado } from "./calculadora";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Lê os valores atuais (não controlados) do formulário para preservá-los ao reaplicar valores. */
function readForm(form: HTMLFormElement | null | undefined, fields: FieldDef[]): Values {
  const out: Values = {};
  if (!form) return out;
  const fd = new FormData(form);
  for (const f of fields) {
    if (f.type === "hidden") continue;
    if (f.type === "checkbox") out[f.name] = fd.get(f.name) === "on";
    else if (f.type === "multiselect") out[f.name] = fd.getAll(`${f.name}[]`).filter((v): v is string => typeof v === "string");
    else {
      const v = fd.get(f.name);
      if (typeof v === "string") out[f.name] = v;
    }
  }
  return out;
}

const fromCalculo = (r: CalculoResultado): Values => ({
  data_publicacao: r.data_publicacao,
  dias: r.dias,
  contagem: r.contagem,
  feriados_extras: r.feriados_extras,
  data_fim: r.data_fim,
  manual: false,
});

/** Painel lateral com o formulário de prazo e a calculadora CPC recolhível. */
export function PrazoFormDrawer({
  open,
  onClose,
  action,
  fields,
  values,
  hidden,
  title,
  description,
  submitLabel,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  action: FormAction;
  fields: FieldDef[];
  values?: Values;
  hidden?: Values;
  title: string;
  description?: string;
  submitLabel?: string;
  onSuccess: (s: ActionState) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<{ key: number; values?: Values }>({ key: 0, values });
  const [calcOpen, setCalcOpen] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);

  // Ao reabrir, volta aos valores iniciais recebidos.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setForm((f) => ({ key: f.key + 1, values }));
      setCalcOpen(false);
    }
  }

  const apply = (r: CalculoResultado) => {
    const current = readForm(wrap.current?.querySelector("form"), fields);
    setForm((f) => ({ key: f.key + 1, values: { ...f.values, ...current, ...fromCalculo(r) } }));
    setCalcOpen(false);
  };

  return (
    <Drawer open={open} onClose={onClose} title={title} description={description} width="max-w-2xl">
      <div className="mb-5 rounded-2xl border border-line">
        <button
          type="button"
          onClick={() => setCalcOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold hover:bg-surface-2"
          aria-expanded={calcOpen}
        >
          <Calculator className="h-4 w-4 text-brand-600 dark:text-brand-300" />
          Calculadora de prazo (CPC)
          <span className="ml-1 hidden font-normal text-muted sm:inline">— confira os dias pulados antes de salvar</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 text-muted transition", calcOpen && "rotate-180")} />
        </button>
        {calcOpen && (
          <div className="border-t border-line p-4">
            <Calculadora
              key={form.key}
              compact
              initial={{
                data_publicacao: typeof form.values?.data_publicacao === "string" ? form.values.data_publicacao : null,
                dias: typeof form.values?.dias === "number" || typeof form.values?.dias === "string" ? form.values.dias : null,
                contagem: typeof form.values?.contagem === "string" ? form.values.contagem : null,
                feriados_extras: typeof form.values?.feriados_extras === "string" ? form.values.feriados_extras : null,
              }}
              onUse={apply}
              useLabel="Usar no formulário"
            />
          </div>
        )}
      </div>
      <div ref={wrap}>
        {open && <ResourceForm key={form.key} action={action} fields={fields} values={form.values} hidden={hidden} submitLabel={submitLabel} onSuccess={onSuccess} />}
      </div>
    </Drawer>
  );
}

/** Remove "?novo=1&processo_id=…" da URL após criar (sem useSearchParams). */
function useClearNovo() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    const p = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    if (p.get("novo")) {
      p.delete("novo");
      p.delete("processo_id");
      p.delete("cliente_id");
      router.replace(`${pathname}${p.size ? `?${p}` : ""}`, { scroll: false });
    } else router.refresh();
  }, [pathname, router]);
}

/** Botão "Novo prazo" (painel + calculadora), compatível com `?novo=1&processo_id=`. */
export function NovoPrazoButton({
  action,
  fields,
  values,
  hidden,
  defaultOpen = false,
  label = "Novo prazo",
  variant = "accent",
  size = "md",
}: {
  action: FormAction;
  fields: FieldDef[];
  values?: Values;
  hidden?: Values;
  defaultOpen?: boolean;
  label?: string;
  variant?: "primary" | "accent" | "secondary" | "outline";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const done = useClearNovo();
  const close = useCallback(() => setOpen(false), []);
  const onSuccess = useCallback(() => {
    setOpen(false);
    done();
  }, [done]);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {label}
      </Button>
      <PrazoFormDrawer
        open={open}
        onClose={close}
        action={action}
        fields={fields}
        values={values}
        hidden={hidden}
        title="Novo prazo"
        description="Informe a publicação e os dias: o vencimento é calculado pelo CPC."
        submitLabel="Cadastrar prazo"
        onSuccess={onSuccess}
      />
    </>
  );
}

/** Card lateral com a calculadora; "Criar prazo com esta data" abre o formulário preenchido. */
export function CalculadoraCard({ action, fields, values, canCreate }: { action: FormAction; fields: FieldDef[]; values?: Values; canCreate: boolean }) {
  const [create, setCreate] = useState<Values | null>(null);
  const router = useRouter();
  const close = useCallback(() => setCreate(null), []);
  const onSuccess = useCallback(() => {
    setCreate(null);
    router.refresh();
  }, [router]);
  return (
    <Card>
      <CardHeader title="Calculadora de prazos" description="Dias úteis (CPC art. 219), feriados nacionais e recesso forense" icon={<Calculator className="h-4 w-4" />} />
      <div className="p-5">
        <Calculadora compact onUse={canCreate ? (r) => setCreate({ ...values, ...fromCalculo(r) }) : undefined} />
      </div>
      {canCreate && (
        <PrazoFormDrawer
          open={!!create}
          onClose={close}
          action={action}
          fields={fields}
          values={create ?? undefined}
          title="Novo prazo"
          description="Vencimento preenchido pela calculadora — confira e complete os dados."
          submitLabel="Cadastrar prazo"
          onSuccess={onSuccess}
        />
      )}
    </Card>
  );
}
