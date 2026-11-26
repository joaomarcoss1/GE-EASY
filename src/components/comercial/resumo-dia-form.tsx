"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Minus, Phone, Plus, Send, Sparkles, X } from "lucide-react";
import { salvarResumoDia, type ResumoDiaInput } from "@/lib/actions/resumo-dia";
import { DIA_AVALIACOES, LIGACAO_RESULTADOS } from "@/lib/constants";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

type Ligacao = ResumoDiaInput["ligacoes_detalhe"][number];
type Contador = "processos_novos" | "processos_trabalhados" | "ligacoes" | "visitas" | "documentos_coletados" | "pendencias_resolvidas" | "exigencias_cumpridas";

export interface ClienteRapido {
  id: string;
  nome: string;
  telefone: string | null;
}

const CONTADORES: { k: Contador; label: string; ajuda: string }[] = [
  { k: "processos_novos", label: "Processos novos", ajuda: "Clientes/processos que você trouxe hoje" },
  { k: "processos_trabalhados", label: "Processos trabalhados", ajuda: "Acompanhou, cobrou documento, atualizou" },
  { k: "ligacoes", label: "Ligações feitas", ajuda: "Total do dia (inclui as da lista abaixo)" },
  { k: "visitas", label: "Visitas / atendimentos", ajuda: "Presenciais" },
  { k: "documentos_coletados", label: "Documentos coletados", ajuda: "" },
  { k: "pendencias_resolvidas", label: "Pendências resolvidas", ajuda: "" },
];
const EXIGENCIAS: { k: Contador; label: string; ajuda: string } = { k: "exigencias_cumpridas", label: "Exigências cumpridas", ajuda: "Processos que saíram de exigência hoje" };

/** Resumo do dia em até 2 minutos: números do sistema já sugeridos, ligações em um toque e três observações curtas. */
export function ResumoDiaForm({ inicial, clientes, sugestao, mostrarExigencias, data, enviadoEm }: {
  inicial: ResumoDiaInput;
  clientes: ClienteRapido[];
  sugestao: { processos: number; ligacoes: number; visitas: number; documentos: number; exigencias: number };
  mostrarExigencias?: boolean;
  data: string;
  enviadoEm: string | null;
}) {
  const [v, setV] = useState<ResumoDiaInput>(inicial);
  const [nome, setNome] = useState("");
  const [resultado, setResultado] = useState<Ligacao["resultado"]>("atendeu");
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const porNome = useMemo(() => new Map(clientes.map((c) => [c.nome.toLowerCase(), c])), [clientes]);
  const set = <K extends keyof ResumoDiaInput>(k: K, valor: ResumoDiaInput[K]) => setV((s) => ({ ...s, [k]: valor }));
  const total = Math.max(v.ligacoes, v.ligacoes_detalhe.length);
  const contadores = mostrarExigencias || (v.exigencias_cumpridas ?? 0) > 0 ? [...CONTADORES, EXIGENCIAS] : CONTADORES;

  const addLigacao = () => {
    const n = nome.trim();
    if (n.length < 2) return toast("Digite o nome de quem recebeu a ligação.", "error");
    const c = porNome.get(n.toLowerCase());
    const nova: Ligacao = { id: crypto.randomUUID(), cliente_id: c?.id ?? null, nome: c?.nome ?? n, telefone: c?.telefone ?? null, resultado, obs: null };
    setV((s) => {
      const lista = [...s.ligacoes_detalhe, nova];
      return { ...s, ligacoes_detalhe: lista, ligacoes: Math.max(s.ligacoes, lista.length) };
    });
    setNome("");
  };

  const enviar = () =>
    start(async () => {
      const r = await salvarResumoDia({ ...v, ligacoes: total, data });
      if (r.ok) {
        toast(r.message ?? "Resumo enviado.");
        router.refresh();
      } else toast(r.error ?? "Não foi possível enviar.", "error");
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:bg-brand-900/30 dark:text-brand-100">
        <Sparkles className="h-4 w-4 shrink-0" />
        <span>O sistema registrou hoje: <b>{sugestao.processos}</b> processo(s) cadastrado(s), <b>{sugestao.ligacoes}</b> ligação(ões) no histórico, <b>{sugestao.visitas}</b> visita(s) e <b>{sugestao.documentos}</b> documento(s){mostrarExigencias && <> e <b>{sugestao.exigencias}</b> exigência(s) cumprida(s)</>}. Já preenchemos para você.</span>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">1. Números do dia</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {contadores.map((c) => {
            const valor = c.k === "ligacoes" ? total : (v[c.k] ?? 0);
            return (
              <div key={c.k} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  {c.ajuda && <p className="truncate text-[11px] text-muted">{c.ajuda}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={`Diminuir ${c.label}`} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-surface-2" onClick={() => set(c.k, Math.max(c.k === "ligacoes" ? v.ligacoes_detalhe.length : 0, valor - 1))}><Minus className="h-4 w-4" /></button>
                  <input
                    inputMode="numeric"
                    aria-label={c.label}
                    className="h-9 w-14 rounded-lg border border-line bg-surface text-center text-base font-bold tabular-nums"
                    value={valor}
                    onChange={(e) => set(c.k, Math.min(1000, Number(e.target.value.replace(/\D/g, "") || 0)))}
                  />
                  <button type="button" aria-label={`Aumentar ${c.label}`} className="grid h-9 w-9 place-items-center rounded-lg bg-brand-700 text-white hover:bg-brand-800" onClick={() => set(c.k, Math.min(1000, valor + 1))}><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">2. Para quem você ligou <span className="font-normal text-muted">({v.ligacoes_detalhe.length} na lista)</span></h2>
        <div className="space-y-2 rounded-xl border border-line p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              list="clientes-resumo"
              className="input flex-1"
              placeholder="Nome do cliente (digite e escolha) ou de quem atendeu"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLigacao(); } }}
              maxLength={160}
            />
            <datalist id="clientes-resumo">{clientes.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
            <button type="button" onClick={addLigacao} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600"><Phone className="h-4 w-4" /> Adicionar</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LIGACAO_RESULTADOS.map((r) => (
              <button key={r.value} type="button" onClick={() => setResultado(r.value as Ligacao["resultado"])} className={cn("rounded-full border px-3 py-1 text-xs font-semibold", resultado === r.value ? "border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100" : "border-line text-muted")}>{r.label}</button>
            ))}
          </div>
          {v.ligacoes_detalhe.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {v.ligacoes_detalhe.map((l) => (
                <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.nome}{l.cliente_id ? "" : <span className="ml-1 text-[11px] text-muted">(não cadastrado)</span>}</span>
                  <select
                    aria-label={`Resultado da ligação para ${l.nome}`}
                    className="input h-8 w-auto py-0 text-xs"
                    value={l.resultado}
                    onChange={(e) => set("ligacoes_detalhe", v.ligacoes_detalhe.map((x) => (x.id === l.id ? { ...x, resultado: e.target.value as Ligacao["resultado"] } : x)))}
                  >
                    {LIGACAO_RESULTADOS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button type="button" aria-label={`Remover ${l.nome}`} className="rounded p-1 text-muted hover:text-red-600" onClick={() => set("ligacoes_detalhe", v.ligacoes_detalhe.filter((x) => x.id !== l.id))}><X className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted">Ligações para clientes cadastrados entram no histórico do cliente automaticamente.</p>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">3. Como foi o dia</h2>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DIA_AVALIACOES.map((a) => (
            <button key={a.value} type="button" onClick={() => set("avaliacao", v.avaliacao === a.value ? null : (a.value as ResumoDiaInput["avaliacao"]))} className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", v.avaliacao === a.value ? "border-brand-600 bg-brand-700 text-white" : "border-line")}>{a.label}</button>
          ))}
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          <textarea className="input" rows={2} maxLength={1000} placeholder="O que fez de mais importante (opcional)" value={v.atividades ?? ""} onChange={(e) => set("atividades", e.target.value)} />
          <textarea className="input" rows={2} maxLength={1000} placeholder="Dificuldades ou pendências para a gestão (opcional)" value={v.dificuldades ?? ""} onChange={(e) => set("dificuldades", e.target.value)} />
          <textarea className="input" rows={2} maxLength={1000} placeholder="Plano para amanhã (opcional)" value={v.plano_amanha ?? ""} onChange={(e) => set("plano_amanha", e.target.value)} />
        </div>
      </section>

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
        <p className="text-sm text-muted">
          {enviadoEm ? <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Enviado. Você pode corrigir até amanhã.</span> : `${v.processos_novos} novo(s) · ${v.processos_trabalhados} trabalhado(s) · ${total} ligação(ões)`}
        </p>
        <button type="button" disabled={pending} onClick={enviar} className="inline-flex items-center gap-2 rounded-xl bg-brand-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-800 disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {enviadoEm ? "Atualizar resumo" : "Enviar resumo"}
        </button>
      </div>
    </div>
  );
}
