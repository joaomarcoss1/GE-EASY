"use client";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/** Valor em formato brasileiro com um trecho numérico (ex.: "R$ 1.234,50", "87%", "12"). */
const PADRAO = /^(\D*?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\D*)$/;

/** Conta de 0 até o valor ao aparecer na tela. Textos que não são números ficam como estão. */
export function CountUp({ value, duration = 900, className }: { value: string | number; duration?: number; className?: string }) {
  const texto = typeof value === "number" ? value.toLocaleString("pt-BR") : value;
  const m = PADRAO.exec(texto.trim());
  const [pronto, setPronto] = useState(!m);
  const [atual, setAtual] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const alvo = m ? Number(m[2].replace(/\./g, "") + (m[3] ? "." + m[3] : "")) : 0;
  const casas = m?.[3]?.length ?? 0;

  useEffect(() => {
    if (!m) return;
    const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduzir || alvo === 0) { setPronto(true); return; }
    let raf = 0;
    let iniciado = false;
    const iniciar = () => {
      if (iniciado) return;
      iniciado = true;
      setAtual(0);
      setPronto(true);
      const t0 = performance.now();
      const passo = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const ease = 1 - Math.pow(1 - p, 4); // easeOutQuart
        setAtual(alvo * ease);
        if (p < 1) raf = requestAnimationFrame(passo);
        else setAtual(null);
      };
      raf = requestAnimationFrame(passo);
    };
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") { iniciar(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); iniciar(); } }, { threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  if (!m) return <span className={className}>{texto}</span>;
  const [, prefixo, , , sufixo] = m;
  const mostrado = atual === null ? texto : `${prefixo}${atual.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}${sufixo}`;
  return (
    <span ref={ref} className={cn("tabular-nums", !pronto && "cu-pending", className)}>
      {mostrado}
    </span>
  );
}
