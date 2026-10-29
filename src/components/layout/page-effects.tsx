"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Efeitos globais da interface: barra de progresso ao navegar e brilho que segue o cursor
 * nos cartões interativos (`.card-interactive`). Não altera dados nem rotas.
 */
export function PageEffects() {
  const pathname = usePathname();
  const [ativo, setAtivo] = useState(false);
  const [fim, setFim] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // começa ao clicar num link interno; termina quando o caminho muda
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      clearTimeout(timer.current);
      setFim(false);
      setAtivo(true);
      timer.current = setTimeout(() => setAtivo(false), 8000); // rede lenta: não deixa a barra presa
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  useEffect(() => {
    setFim(true);
    timer.current = setTimeout(() => { setAtivo(false); setFim(false); }, 350);
    return () => clearTimeout(timer.current);
  }, [pathname]);

  // brilho que acompanha o cursor
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.(".card-interactive") as HTMLElement | null;
      if (!card) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => { document.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf); };
  }, []);

  if (!ativo) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px]" role="progressbar" aria-hidden="true">
      <div
        className="h-full origin-left bg-gradient-to-r from-brand-500 via-accent-500 to-accent-300 shadow-[0_0_12px_rgb(225_79_38/0.7)]"
        style={fim ? { transform: "scaleX(1)", transition: "transform .25s ease-out, opacity .3s .1s", opacity: 0 } : { animation: "route-progress 6s cubic-bezier(.1,.6,.2,1) forwards" }}
      />
    </div>
  );
}
