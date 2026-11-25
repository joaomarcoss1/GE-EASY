"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, CircleDashed, Download, FolderArchive, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

interface Item { categoria: string; nome: string; obrigatorio: boolean; escopo: string; situacao: string; arquivos: number }
interface Gerado { id: string; destino: string; arquivos: number; tamanho: number; faltando: string[]; por: string; created_at: string; url: string | null; pdfUrl: string | null }

const SIT: Record<string, { txt: string; cls: string }> = {
  aprovado: { txt: "Aprovado", cls: "text-emerald-700 dark:text-emerald-400" },
  enviado: { txt: "Enviado, a conferir", cls: "text-sky-700 dark:text-sky-300" },
  recusado: { txt: "Recusado", cls: "text-red-600" },
  vencido: { txt: "Vencido", cls: "text-red-600" },
  faltando: { txt: "Faltando", cls: "text-red-600" },
};
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/**
 * Dossiê do processo: checklist do que o benefício exige (INSS ou Justiça), geração do pacote (ZIP com resumo,
 * PDF único e documentos) e os dossiês já gerados.
 */
export function DossieButton({ casoId, cliente, tipo, compacto }: { casoId: string; cliente: string; tipo: string; compacto?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<"inss" | "justica">("inss");
  const [dados, setDados] = useState<{ itens: Item[]; faltando: string[]; dossies: Gerado[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [link, setLink] = useState<{ zip: string | null; pdf: string | null } | null>(null);
  const toast = useToast();

  const carregar = useCallback(async (d: "inss" | "justica") => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/casos/${casoId}/dossie?destino=${d}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Não foi possível carregar.");
      setDados({ itens: j.checklist.itens ?? [], faltando: j.checklist.faltando ?? [], dossies: j.dossies ?? [] });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Não foi possível carregar.", "error");
    } finally {
      setCarregando(false);
    }
  }, [casoId, toast]);

  useEffect(() => { if (aberto) void carregar(destino); }, [aberto, destino, carregar]);

  const gerar = async () => {
    setGerando(true);
    setLink(null);
    try {
      const r = await fetch(`/api/casos/${casoId}/dossie`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destino }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Não foi possível gerar o dossiê.");
      setLink({ zip: j.url, pdf: j.pdfUrl });
      toast(`Dossiê gerado com ${j.arquivos} arquivo(s)${j.faltando?.length ? `. Faltam ${j.faltando.length} obrigatório(s).` : "."}`);
      void carregar(destino);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Não foi possível gerar o dossiê.", "error");
    } finally {
      setGerando(false);
    }
  };

  const obrig = dados?.itens.filter((i) => i.obrigatorio) ?? [];
  const prontos = obrig.filter((i) => i.situacao === "aprovado" || i.situacao === "enviado").length;

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Dossiê do processo para o INSS ou a Justiça"
        className={cn("inline-flex items-center gap-1.5 rounded-lg border border-line font-semibold transition hover:bg-surface-2", compacto ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm")}
      >
        <FolderArchive className="h-4 w-4" /> Dossiê
      </button>
      <Modal open={aberto} onClose={() => setAberto(false)} title={`Dossiê — ${cliente}`} className="max-w-2xl">
        <div className="space-y-4">
          <p className="text-sm text-muted">{tipo}. O dossiê junta os dados do cliente, o histórico do processo, as fichas e os documentos anexados. Sai em dois arquivos: um ZIP com o resumo e os documentos originais, e um PDF único pronto para protocolar no INSS ou no processo judicial.</p>

          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Destino">
            {([["inss", "INSS (requerimento)"], ["justica", "Justiça (ação judicial)"]] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={destino === v} onClick={() => setDestino(v)}
                className={cn("rounded-full border px-3 py-1 text-sm font-semibold", destino === v ? "border-brand-600 bg-brand-700 text-white" : "border-line text-muted hover:bg-surface-2")}>
                {l}
              </button>
            ))}
          </div>

          {carregando || !dados ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Conferindo documentos…</div>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-sm font-semibold">Documentos exigidos · {prontos} de {obrig.length} obrigatórios enviados</p>
                <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {dados.itens.map((i) => {
                    const s = SIT[i.situacao] ?? SIT.faltando;
                    const ok = i.situacao === "aprovado" || i.situacao === "enviado";
                    return (
                      <li key={i.categoria} className="flex items-center gap-2 px-3 py-2 text-sm">
                        {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : i.obrigatorio ? <CircleAlert className="h-4 w-4 shrink-0 text-red-600" /> : <CircleDashed className="h-4 w-4 shrink-0 text-muted" />}
                        <span className="min-w-0 flex-1">{i.nome}{!i.obrigatorio && <span className="ml-1 text-xs text-muted">(opcional)</span>}</span>
                        <span className={cn("shrink-0 text-xs font-semibold", ok ? s.cls : i.obrigatorio ? s.cls : "text-muted")}>{i.arquivos ? `${s.txt} · ${i.arquivos}` : s.txt}</span>
                      </li>
                    );
                  })}
                  {!dados.itens.length && <li className="px-3 py-3 text-sm text-muted">Nenhum documento exigido cadastrado. Configure em Configurações › Documentação.</li>}
                </ul>
                {dados.faltando.length > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    Faltam {dados.faltando.length} documento(s) obrigatório(s). Dá para gerar mesmo assim: o resumo do dossiê mostra o que falta. Anexe na ficha do cliente › aba Documentos.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={gerar} disabled={gerando} className="inline-flex items-center gap-2 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-accent-600 disabled:opacity-60">
                  {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderArchive className="h-4 w-4" />} {gerando ? "Montando o dossiê…" : `Gerar dossiê para ${destino === "inss" ? "o INSS" : "a Justiça"}`}
                </button>
                {link?.zip && <a href={link.zip} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-2"><Download className="h-4 w-4" /> Baixar ZIP (resumo + documentos)</a>}
                {link?.pdf && <a href={link.pdf} className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-2"><Download className="h-4 w-4" /> Baixar PDF único</a>}
              </div>

              {dados.dossies.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-semibold">Dossiês gerados</p>
                  <ul className="divide-y divide-line rounded-xl border border-line text-sm">
                    {dados.dossies.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                        <span className="font-medium">{d.destino === "inss" ? "INSS" : "Justiça"}</span>
                        <span className="text-xs text-muted">{new Date(d.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {d.por} · {d.arquivos} arquivo(s) · {mb(d.tamanho)}{d.faltando?.length ? ` · faltavam ${d.faltando.length}` : ""}</span>
                        <span className="ml-auto flex gap-3">
                          {d.url && <a href={d.url} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"><Download className="h-3.5 w-3.5" /> ZIP</a>}
                          {d.pdfUrl && <a href={d.pdfUrl} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"><Download className="h-3.5 w-3.5" /> PDF único</a>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
