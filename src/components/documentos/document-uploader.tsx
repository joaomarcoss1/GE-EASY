"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CloudUpload, Loader2, AlertTriangle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { registerDocumento } from "@/lib/actions/documentos";
import { DOC_CATEGORIAS } from "@/lib/constants";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { DOC_ACCEPT, MAX_DOC_BYTES, formatBytes, resolveMime, sanitizeFileName } from "./mime";

type Status = "pendente" | "enviando" | "registrando" | "concluido" | "erro";
interface Item {
  key: string;
  file: File;
  status: Status;
  error?: string;
}

const MAX_FILES = 20;

const STATUS_LABEL: Record<Status, string> = {
  pendente: "Na fila",
  enviando: "Enviando…",
  registrando: "Registrando…",
  concluido: "Concluído",
  erro: "Erro",
};

/** Área de envio (arrastar e soltar) — o arquivo vai direto do navegador ao Storage (RLS) e depois é registrado. */
export function DocumentUploader({ clienteId }: { clienteId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [categoria, setCategoria] = useState("outros");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list).slice(0, MAX_FILES);
      setItems((prev) => {
        const keep = prev.filter((i) => i.status !== "concluido");
        const next = incoming.map<Item>((file) => {
          const mime = resolveMime(file.name, file.type);
          const error = !mime ? "Tipo não permitido" : file.size > MAX_DOC_BYTES ? "Maior que 25 MB" : file.size === 0 ? "Arquivo vazio" : undefined;
          return { key: crypto.randomUUID(), file, status: error ? "erro" : "pendente", error };
        });
        return [...keep, ...next].slice(-MAX_FILES);
      });
    },
    [],
  );

  const update = (key: string, patch: Partial<Item>) => setItems((s) => s.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function uploadAll() {
    const queue = items.filter((i) => i.status === "pendente");
    if (!queue.length) return;
    setBusy(true);
    setProgress({ done: 0, total: queue.length });
    const supabase = createClient();
    let ok = 0;
    for (const [n, item] of queue.entries()) {
      setProgress({ done: n, total: queue.length });
      const mime = resolveMime(item.file.name, item.file.type) ?? "application/octet-stream";
      const path = `clientes/${clienteId}/${crypto.randomUUID()}-${sanitizeFileName(item.file.name)}`;
      update(item.key, { status: "enviando", error: undefined });
      const { error: upError } = await supabase.storage.from("documentos").upload(path, item.file, { contentType: mime, upsert: false, cacheControl: "3600" });
      if (upError) {
        update(item.key, { status: "erro", error: upError.message.includes("row-level security") ? "Sem permissão para este cliente" : "Falha no envio" });
        continue;
      }
      update(item.key, { status: "registrando" });
      const r = await registerDocumento({ cliente_id: clienteId, storage_path: path, nome: item.file.name.slice(0, 255), categoria });
      if (r.ok) {
        ok++;
        update(item.key, { status: "concluido" });
      } else update(item.key, { status: "erro", error: r.error ?? "Falha ao registrar" });
    }
    setProgress({ done: queue.length, total: queue.length });
    setBusy(false);
    if (ok) {
      toast(ok === 1 ? "Documento enviado." : `${ok} documentos enviados.`);
      router.refresh();
    }
  }

  const pending = items.filter((i) => i.status === "pendente").length;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Selecionar arquivos para envio"
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition",
          dragging ? "border-accent-400 bg-accent-50/60 dark:bg-accent-900/20" : "border-line bg-surface-2/50 hover:border-brand-300 hover:bg-surface-2",
        )}
      >
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
          <CloudUpload className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-semibold">Arraste os arquivos aqui ou clique para selecionar</p>
        <p className="mt-1 text-xs text-muted">PDF, imagens (JPG, PNG, WEBP, HEIC), Word, Excel, TXT ou CSV · até 25 MB cada</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOC_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="rounded-2xl border border-line">
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="grid h-7 w-7 shrink-0 place-items-center">
                  {i.status === "concluido" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : i.status === "erro" ? (
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  ) : i.status === "pendente" ? (
                    <span className="h-2 w-2 rounded-full bg-slate-300" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.file.name}</span>
                  <span className={cn("block text-xs", i.status === "erro" ? "text-red-600" : "text-muted")}>
                    {formatBytes(i.file.size)} · {i.error ?? STATUS_LABEL[i.status]}
                  </span>
                </span>
                {(i.status === "pendente" || i.status === "erro") && !busy && (
                  <button type="button" onClick={() => setItems((s) => s.filter((x) => x.key !== i.key))} className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Remover ${i.file.name}`}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {busy && progress.total > 0 && (
            <div className="h-1 overflow-hidden bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Progresso do envio">
              <div className="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-500" style={{ width: `${Math.max(6, ((progress.done + 0.5) / progress.total) * 100)}%` }} />
            </div>
          )}
          <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center">
            <label htmlFor="doc-categoria" className="text-xs font-medium text-muted">
              Categoria
            </label>
            <select id="doc-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} className="input h-9 w-full sm:w-60" disabled={busy}>
              {DOC_CATEGORIAS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <div className="flex gap-2 sm:ml-auto">
              {!busy && items.some((i) => i.status === "concluido" || i.status === "erro") && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setItems((s) => s.filter((i) => i.status === "pendente"))}>
                  Limpar
                </Button>
              )}
              <Button type="button" variant="accent" size="sm" onClick={uploadAll} loading={busy} disabled={!pending}>
                {busy ? "Enviando…" : `Enviar ${pending || ""} arquivo${pending === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
