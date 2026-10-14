"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import type { Option } from "@/lib/constants";
import { Button } from "@/components/ui/button";

/** Escolhe um cliente e abre a aba de documentos dele (onde o envio acontece). */
export function ClientePicker({ options }: { options: Option[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [value, setValue] = useState("");
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options).slice(0, 300);
  }, [filter, options]);

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const id = value || (filtered.length === 1 ? filtered[0].value : "");
        if (/^[0-9a-f-]{36}$/i.test(id)) router.push(`/clientes/${id}?tab=documentos`);
      }}
    >
      <div className="relative sm:w-56">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar clientes…" className="input h-10 pl-9" aria-label="Filtrar clientes" />
      </div>
      <select value={value} onChange={(e) => setValue(e.target.value)} className="input h-10 sm:w-72" aria-label="Cliente">
        <option value="">{filtered.length ? "Selecione o cliente…" : "Nenhum cliente encontrado"}</option>
        {filtered.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="accent" disabled={!value && filtered.length !== 1}>
        Abrir documentos <ArrowRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
