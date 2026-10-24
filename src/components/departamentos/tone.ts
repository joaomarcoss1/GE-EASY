import type { Tone } from "@/lib/constants";

/** Classes estáticas por cor de departamento (o Tailwind precisa das strings completas). */
interface DepTone {
  /** faixa/acento sólido */
  bar: string;
  /** selo da sigla */
  chip: string;
  /** fundo suave (cabeçalho do card) */
  soft: string;
  /** texto colorido */
  text: string;
}

const TONES: Record<Tone, DepTone> = {
  brand: {
    bar: "bg-brand-600 dark:bg-brand-400",
    chip: "bg-brand-700 text-white dark:bg-brand-500",
    soft: "from-brand-50 dark:from-brand-900/40",
    text: "text-brand-700 dark:text-brand-200",
  },
  accent: {
    bar: "bg-accent-500",
    chip: "bg-accent-500 text-white",
    soft: "from-accent-50 dark:from-accent-900/30",
    text: "text-accent-700 dark:text-accent-200",
  },
  green: {
    bar: "bg-emerald-500",
    chip: "bg-emerald-600 text-white",
    soft: "from-emerald-50 dark:from-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    bar: "bg-amber-500",
    chip: "bg-amber-500 text-amber-950",
    soft: "from-amber-50 dark:from-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
  },
  red: {
    bar: "bg-red-500",
    chip: "bg-red-600 text-white",
    soft: "from-red-50 dark:from-red-900/30",
    text: "text-red-700 dark:text-red-300",
  },
  sky: {
    bar: "bg-sky-500",
    chip: "bg-sky-600 text-white",
    soft: "from-sky-50 dark:from-sky-900/30",
    text: "text-sky-700 dark:text-sky-300",
  },
  violet: {
    bar: "bg-violet-500",
    chip: "bg-violet-600 text-white",
    soft: "from-violet-50 dark:from-violet-900/30",
    text: "text-violet-700 dark:text-violet-300",
  },
  slate: {
    bar: "bg-slate-400 dark:bg-slate-500",
    chip: "bg-slate-600 text-white dark:bg-slate-500",
    soft: "from-slate-100 dark:from-white/5",
    text: "text-slate-700 dark:text-slate-300",
  },
};

const isTone = (v: string | null | undefined): v is Tone => !!v && v in TONES;
export const depTone = (cor: string | null | undefined): DepTone => TONES[isTone(cor) ? cor : "brand"];
export const toneOf = (cor: string | null | undefined): Tone => (isTone(cor) ? cor : "brand");

/** Sigla para o selo do departamento (usa a sigla cadastrada ou as iniciais do nome). */
export function depSigla(d: { nome: string; sigla: string | null }) {
  if (d.sigla) return d.sigla.slice(0, 5).toUpperCase();
  const parts = d.nome.split(/\s+/).filter((w) => w.length > 2);
  return (parts.length > 1 ? parts.slice(0, 3).map((w) => w[0]).join("") : d.nome.slice(0, 3)).toUpperCase();
}
