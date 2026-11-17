"use client";
import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/**
 * Quadro de assinatura (dedo ou mouse). Entrega um PNG (fundo branco) a cada traço; null quando limpo.
 * Funciona offline (não depende de rede) e em telas de alta densidade.
 */
export function AssinaturaPad({ onChange, altura = 170, rotulo = "Assine no quadro" }: { onChange: (png: Blob | null) => void; altura?: number; rotulo?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vazio, setVazio] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = c.clientWidth;
    c.width = Math.round(w * dpr);
    c.height = Math.round(altura * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, altura);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, [altura]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const emitir = () => ref.current?.toBlob((b) => onChange(b), "image/png");

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{rotulo}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-semibold text-brand-600 disabled:opacity-40"
          disabled={vazio}
          onClick={() => {
            const c = ref.current;
            if (!c) return;
            const ctx = c.getContext("2d")!;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.restore();
            setVazio(true);
            onChange(null);
          }}
        >
          <Eraser className="h-3.5 w-3.5" /> Limpar
        </button>
      </div>
      <canvas
        ref={ref}
        style={{ height: altura, touchAction: "none" }}
        className="w-full rounded-xl border-2 border-dashed border-line bg-white"
        aria-label={rotulo}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          desenhando.current = true;
          ultimo.current = pos(e);
        }}
        onPointerMove={(e) => {
          if (!desenhando.current || !ultimo.current) return;
          const ctx = e.currentTarget.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(ultimo.current.x, ultimo.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ultimo.current = p;
          if (vazio) setVazio(false);
        }}
        onPointerUp={() => {
          if (!desenhando.current) return;
          desenhando.current = false;
          ultimo.current = null;
          emitir();
        }}
        onPointerLeave={() => {
          if (desenhando.current) {
            desenhando.current = false;
            ultimo.current = null;
            emitir();
          }
        }}
      />
    </div>
  );
}
