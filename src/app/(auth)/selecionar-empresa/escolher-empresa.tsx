"use client";
import { useState, useTransition } from "react";
import { Building2, ChevronRight, Loader2 } from "lucide-react";
import { trocarEmpresa } from "@/lib/actions/empresa";
import type { EmpresaResumo } from "@/lib/types";

const RAIZ = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

export function EscolherEmpresa({ empresas, atual }: { empresas: EmpresaResumo[]; atual: string | null }) {
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const escolher = (e: EmpresaResumo) => {
    setErro(null);
    setEscolhida(e.id);
    if (RAIZ) {
      window.location.href = `https://${e.slug}.${RAIZ}/inicio`;
      return;
    }
    start(async () => {
      const r = await trocarEmpresa(e.id);
      if (r.ok) window.location.href = "/inicio";
      else setErro(r.error ?? "Não foi possível entrar nesta empresa.");
    });
  };
  return (
    <div className="mt-6 space-y-2">
      {empresas.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => escolher(e)}
          disabled={pending}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition hover:border-brand-300 hover:shadow-sm disabled:opacity-60"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200">
            <Building2 className="h-5 w-5" />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold">{e.nome}</span>
            <span className="block text-xs text-muted">{e.id === atual ? "Última usada" : e.status === "trial" ? "Período de avaliação" : e.slug}</span>
          </span>
          {pending && escolhida === e.id ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        </button>
      ))}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
