"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, FileText, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { analisar, carregarImagem, endireitar, paraJpeg, type Filtro } from "@/lib/campo/imagem";
import { montarPdf } from "@/lib/campo/pdf";
import type { Quad } from "@/lib/campo/visao";
import { useCampo } from "./contexto";

interface Pagina {
  jpeg: Blob;
  largura: number;
  altura: number;
  url: string;
}

/**
 * Scanner de documentos: foto pela câmera → detecção de bordas → ajuste dos cantos → correção de
 * perspectiva → filtro (cor, cinza, preto e branco) → validação de qualidade → várias páginas → PDF
 * comprimido, criptografado no aparelho até o envio e vinculado ao cliente.
 */
export function TelaScanner() {
  const { snap, params, registrar, aviso, irPara } = useCampo();
  const [clienteId, setClienteId] = useState(params.cliente ?? "");
  const [categoria, setCategoria] = useState(snap.documento_tipos[0]?.categoria ?? "outros");
  const [paginas, setPaginas] = useState<Pagina[]>([]);
  const [edicao, setEdicao] = useState<{ canvas: HTMLCanvasElement; quad: Quad; problemas: string[]; detectado: boolean } | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("cor");
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const clientes = snap.carteira;
  const nomeCliente = clientes.find((c) => c.id === clienteId)?.nome ?? params.nome ?? "";

  useEffect(() => () => paginas.forEach((p) => URL.revokeObjectURL(p.url)), [paginas]);

  const capturar = async (f: File) => {
    setOcupado(true);
    try {
      const canvas = await carregarImagem(f);
      const a = analisar(canvas);
      setEdicao({ canvas, quad: a.quad, problemas: a.qualidade.problemas, detectado: a.detectado });
    } catch {
      aviso("Não foi possível abrir a foto.", "erro");
    } finally {
      setOcupado(false);
    }
  };

  const aceitarPagina = async () => {
    if (!edicao) return;
    setOcupado(true);
    try {
      const reto = endireitar(edicao.canvas, edicao.quad, filtro);
      const { blob, largura, altura } = await paraJpeg(reto);
      setPaginas((ps) => [...ps, { jpeg: blob, largura, altura, url: URL.createObjectURL(blob) }]);
      setEdicao(null);
    } finally {
      setOcupado(false);
    }
  };

  const salvar = async () => {
    if (!clienteId) return aviso("Escolha o cliente.", "erro");
    if (!paginas.length) return aviso("Capture ao menos uma página.", "erro");
    setOcupado(true);
    try {
      const pdf = montarPdf(await Promise.all(paginas.map(async (p) => ({ jpeg: new Uint8Array(await p.jpeg.arrayBuffer()), largura: p.largura, altura: p.altura }))));
      const tipo = snap.documento_tipos.find((t) => t.categoria === categoria);
      const id = crypto.randomUUID();
      await registrar("documento", { id, cliente_id: clienteId, categoria, nome: `${tipo?.nome ?? "Documento"} (${paginas.length} pág.).pdf` }, `Documento: ${tipo?.nome ?? categoria}`, [
        { campo: "arquivo", nome: "documento.pdf", blob: new Blob([pdf as BlobPart], { type: "application/pdf" }) },
      ]);
      aviso(`Documento salvo (${(pdf.length / 1024 / 1024).toFixed(1)} MB). Será enviado para análise.`);
      setPaginas([]);
    } finally {
      setOcupado(false);
    }
  };

  if (edicao) return <AjusteCantos edicao={edicao} setQuad={(q) => setEdicao({ ...edicao, quad: q })} filtro={filtro} setFiltro={setFiltro} ocupado={ocupado} onCancelar={() => setEdicao(null)} onAceitar={aceitarPagina} />;

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Scanner de documentos</h1>
      <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)} aria-label="Cliente">
        <option value="">Cliente…</option>
        {params.cliente && !clientes.some((c) => c.id === params.cliente) && <option value={params.cliente}>{params.nome ?? "Pré-cadastro novo"}</option>}
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.documento ? ` · ${c.documento}` : ""}</option>)}
      </select>
      <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Tipo de documento">
        {snap.documento_tipos.map((t) => <option key={t.categoria} value={t.categoria}>{t.nome}{t.obrigatorio ? " *" : ""}</option>)}
        <option value="outros">Outros</option>
      </select>
      <input ref={entrada} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) capturar(f); e.target.value = ""; }} />
      <button type="button" disabled={ocupado} onClick={() => entrada.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent-500 py-4 text-base font-bold text-white">
        {ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} {paginas.length ? "Próxima página" : "Fotografar documento"}
      </button>
      <p className="text-xs text-muted">Dica: coloque o documento sobre uma superfície escura, com boa luz e sem reflexo.</p>
      {paginas.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {paginas.map((p, i) => (
              <div key={p.url} className="relative overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) */}
                <img src={p.url} alt={`Página ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                <button type="button" onClick={() => setPaginas(paginas.filter((x) => x !== p))} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white" aria-label="Remover página"><Trash2 className="h-3.5 w-3.5" /></button>
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{i + 1}</span>
              </div>
            ))}
          </div>
          <button type="button" disabled={ocupado} onClick={salvar} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3.5 font-bold text-white">
            {ocupado ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />} Salvar PDF ({paginas.length} pág.){nomeCliente ? ` — ${nomeCliente.split(" ")[0]}` : ""}
          </button>
        </>
      )}
      {!snap.documento_tipos.length && <button type="button" onClick={() => irPara("inicio")} className="text-sm text-muted">Voltar</button>}
    </div>
  );
}

/** Prévia com os quatro cantos arrastáveis, filtro e avisos de qualidade. */
function AjusteCantos({ edicao, setQuad, filtro, setFiltro, ocupado, onCancelar, onAceitar }: {
  edicao: { canvas: HTMLCanvasElement; quad: Quad; problemas: string[]; detectado: boolean };
  setQuad: (q: Quad) => void; filtro: Filtro; setFiltro: (f: Filtro) => void; ocupado: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const arrastando = useRef<number | null>(null);
  const [forcar, setForcar] = useState(false);
  const { canvas, quad } = edicao;
  const escala = Math.min(1, 340 / canvas.width);

  useEffect(() => {
    const c = ref.current!;
    c.width = Math.round(canvas.width * escala);
    c.height = Math.round(canvas.height * escala);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    ctx.strokeStyle = "#E14F26";
    ctx.lineWidth = 3;
    ctx.beginPath();
    quad.forEach((p, i) => (i ? ctx.lineTo(p.x * escala, p.y * escala) : ctx.moveTo(p.x * escala, p.y * escala)));
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#E14F26";
    quad.forEach((p) => { ctx.beginPath(); ctx.arc(p.x * escala, p.y * escala, 10, 0, Math.PI * 2); ctx.fill(); });
  }, [canvas, quad, escala]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * (ref.current!.width / r.width)) / escala, y: ((e.clientY - r.top) * (ref.current!.height / r.height)) / escala };
  };
  const bloqueante = edicao.problemas.some((p) => /cortado/.test(p));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{edicao.detectado ? "Ajuste os cantos se precisar." : "Documento não detectado: arraste os cantos até as bordas."}</p>
      <canvas
        ref={ref}
        className="w-full touch-none rounded-xl border border-line"
        onPointerDown={(e) => {
          const p = pos(e);
          let k = 0;
          quad.forEach((q, i) => { if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(quad[k].x - p.x, quad[k].y - p.y)) k = i; });
          arrastando.current = k;
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (arrastando.current == null) return;
          const p = pos(e);
          const q = [...quad] as Quad;
          q[arrastando.current] = { x: Math.max(0, Math.min(canvas.width - 1, p.x)), y: Math.max(0, Math.min(canvas.height - 1, p.y)) };
          setQuad(q);
        }}
        onPointerUp={() => { arrastando.current = null; }}
      />
      <div className="grid grid-cols-3 gap-2">
        {([["cor", "Cor"], ["cinza", "Cinza"], ["pb", "P&B"]] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFiltro(v)} className={`rounded-xl border py-2 text-sm font-semibold ${filtro === v ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line"}`}>{l}</button>
        ))}
      </div>
      {edicao.problemas.length > 0 && (
        <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {edicao.problemas.map((p) => <p key={p} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{p}</p>)}
          {!bloqueante && <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} /> Usar mesmo assim</label>}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-line py-3 font-semibold"><RotateCcw className="h-4 w-4" /> Refazer</button>
        <button type="button" disabled={ocupado || (edicao.problemas.length > 0 && (bloqueante || !forcar))} onClick={onAceitar} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white disabled:opacity-50">{ocupado && <Loader2 className="h-4 w-4 animate-spin" />}Aceitar página</button>
      </div>
    </div>
  );
}
