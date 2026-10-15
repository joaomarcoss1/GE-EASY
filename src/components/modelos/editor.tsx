"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Braces, Pencil, Plus } from "lucide-react";
import { MODELO_CATEGORIAS, PROCESSO_AREAS } from "@/lib/constants";
import { PLACEHOLDERS } from "@/lib/juridico/merge";
import type { ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SubmitButton } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

interface ModeloValues {
  id?: string;
  titulo?: string;
  categoria?: string;
  area?: string | null;
  descricao?: string | null;
  conteudo?: string;
  ativo?: boolean;
}

/** Editor de modelo com lista de campos automáticos que são inseridos na posição do cursor. */
export function ModeloEditor({ action, values, label }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; values?: ModeloValues; label?: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  const [texto, setTexto] = useState(values?.conteudo ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(values?.id);

  useEffect(() => {
    if (state.ok) {
      toast(state.message ?? "Salvo.");
      setOpen(false);
      router.refresh();
    } else if (state.error && !state.fieldErrors) toast(state.error, "error");
  }, [state, toast, router]);

  const inserir = (key: string) => {
    const el = ref.current;
    const tag = `{{${key}}}`;
    if (!el) return setTexto((t) => t + tag);
    const { selectionStart: s, selectionEnd: e } = el;
    const next = texto.slice(0, s) + tag + texto.slice(e);
    setTexto(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + tag.length, s + tag.length);
    });
  };

  return (
    <>
      {editing ? (
        <Button size="icon" variant="ghost" onClick={() => setOpen(true)} aria-label="Editar modelo" title="Editar modelo">
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button variant="accent" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> {label ?? "Novo modelo"}
        </Button>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title={editing ? "Editar modelo" : "Novo modelo de documento"} width="max-w-5xl">
        <form action={formAction} className="grid gap-5 lg:grid-cols-[1fr_260px]">
          {values?.id && <input type="hidden" name="id" value={values.id} />}
          <div className="space-y-4">
            {state.error && state.fieldErrors && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{state.error}</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <label className="label" htmlFor="m-titulo">Título *</label>
                <input id="m-titulo" name="titulo" defaultValue={values?.titulo} required className="input" aria-invalid={state.fieldErrors?.titulo ? true : undefined} />
              </div>
              <div>
                <label className="label" htmlFor="m-cat">Categoria</label>
                <select id="m-cat" name="categoria" defaultValue={values?.categoria ?? "peticao"} className="input">
                  {MODELO_CATEGORIAS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="m-area">Área</label>
                <select id="m-area" name="area" defaultValue={values?.area ?? ""} className="input">
                  <option value="">Todas</option>
                  {PROCESSO_AREAS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <label className="flex items-end gap-2 pb-2.5 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={values?.ativo ?? true} className="h-4 w-4 accent-brand-700" /> Ativo
              </label>
              <div className="sm:col-span-3">
                <label className="label" htmlFor="m-desc">Descrição</label>
                <input id="m-desc" name="descricao" defaultValue={values?.descricao ?? ""} className="input" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="m-conteudo">Conteúdo *</label>
              <textarea ref={ref} id="m-conteudo" name="conteudo" value={texto} onChange={(e) => setTexto(e.target.value)} rows={22} className="input font-serif text-[15px] leading-relaxed" placeholder="Escreva o modelo. Use os campos automáticos ao lado, ex.: {{cliente.nome}}" aria-invalid={state.fieldErrors?.conteudo ? true : undefined} />
              {state.fieldErrors?.conteudo && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.conteudo}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <SubmitButton>Salvar modelo</SubmitButton>
            </div>
          </div>
          <aside className="rounded-2xl border border-line bg-surface-2 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Braces className="h-4 w-4 text-brand-600" /> Campos automáticos</p>
            <p className="mb-3 text-xs text-muted">Clique para inserir no cursor. São preenchidos com os dados do cliente, processo e contrato ao gerar.</p>
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {PLACEHOLDERS.map((p) => (
                <li key={p.key}>
                  <button type="button" onClick={() => inserir(p.key)} className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface">
                    <span className="block font-medium">{p.label}</span>
                    <code className="text-[11px] text-brand-600 dark:text-brand-300">{`{{${p.key}}}`}</code>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </form>
      </Drawer>
    </>
  );
}
