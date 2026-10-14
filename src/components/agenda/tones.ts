import type { Tone } from "@/lib/constants";
import { EVENTO_TIPOS } from "@/lib/constants";

/** Classes por tom (escritas por extenso para o Tailwind detectá-las). */
export const TONE_CLS: Record<Tone, { chip: string; block: string; dot: string; bar: string }> = {
  brand: {
    chip: "bg-brand-50 text-brand-800 hover:bg-brand-100 dark:bg-brand-900/60 dark:text-brand-100 dark:hover:bg-brand-900",
    block: "border-brand-600 bg-brand-50 text-brand-900 hover:bg-brand-100 dark:bg-brand-900/70 dark:text-brand-50",
    dot: "bg-brand-600 dark:bg-brand-400",
    bar: "bg-brand-600",
  },
  accent: {
    chip: "bg-accent-50 text-accent-800 hover:bg-accent-100 dark:bg-accent-900/40 dark:text-accent-100 dark:hover:bg-accent-900/60",
    block: "border-accent-500 bg-accent-50 text-accent-900 hover:bg-accent-100 dark:bg-accent-900/50 dark:text-accent-50",
    dot: "bg-accent-500",
    bar: "bg-accent-500",
  },
  sky: {
    chip: "bg-sky-50 text-sky-800 hover:bg-sky-100 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:bg-sky-900/60",
    block: "border-sky-500 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:bg-sky-900/50 dark:text-sky-50",
    dot: "bg-sky-500",
    bar: "bg-sky-500",
  },
  violet: {
    chip: "bg-violet-50 text-violet-800 hover:bg-violet-100 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/60",
    block: "border-violet-500 bg-violet-50 text-violet-900 hover:bg-violet-100 dark:bg-violet-900/50 dark:text-violet-50",
    dot: "bg-violet-500",
    bar: "bg-violet-500",
  },
  amber: {
    chip: "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60",
    block: "border-amber-500 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-900/50 dark:text-amber-50",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  green: {
    chip: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60",
    block: "border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-50",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
  },
  red: {
    chip: "bg-red-50 text-red-800 hover:bg-red-100 dark:bg-red-900/40 dark:text-red-100 dark:hover:bg-red-900/60",
    block: "border-red-500 bg-red-50 text-red-900 hover:bg-red-100 dark:bg-red-900/50 dark:text-red-50",
    dot: "bg-red-500",
    bar: "bg-red-500",
  },
  slate: {
    chip: "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15",
    block: "border-slate-400 bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-100",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
  },
};

export const tipoTone = (tipo: string): Tone => EVENTO_TIPOS.find((t) => t.value === tipo)?.tone ?? "slate";
export const toneOf = (tipo: string) => TONE_CLS[tipoTone(tipo)];
