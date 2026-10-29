"use client";
import { useRef } from "react";
import Image from "next/image";
import { BadgeCheck, Building2, Fingerprint, ShieldCheck } from "lucide-react";

const PARTICULAS = [
  { x: 12, y: 18, s: 3, d: 4.2, l: 0 }, { x: 82, y: 14, s: 2, d: 5.1, l: 1.2 }, { x: 24, y: 70, s: 2, d: 3.8, l: 0.6 },
  { x: 70, y: 76, s: 3, d: 4.6, l: 2.1 }, { x: 90, y: 48, s: 2, d: 5.4, l: 0.9 }, { x: 8, y: 44, s: 2, d: 4.9, l: 1.8 },
  { x: 48, y: 8, s: 2, d: 4.1, l: 2.6 }, { x: 58, y: 90, s: 3, d: 5.6, l: 0.3 }, { x: 36, y: 30, s: 2, d: 3.9, l: 1.5 },
];
const BRASAS = [
  { x: 18, d: 9, l: 0 }, { x: 34, d: 11, l: 3 }, { x: 52, d: 8, l: 5 }, { x: 66, d: 10, l: 1.5 }, { x: 80, d: 12, l: 6.5 }, { x: 90, d: 9.5, l: 4 },
];
const SELOS = [
  { icon: Building2, label: "Multiempresa" },
  { icon: Fingerprint, label: "Auditoria completa" },
  { icon: ShieldCheck, label: "LGPD" },
  { icon: BadgeCheck, label: "2FA" },
];
const PARTES = [
  { src: "/brand/marca-2.png", fx: "-46px", fy: "-18px", delay: "0.15s" },
  { src: "/brand/marca-1.png", fx: "-30px", fy: "36px", delay: "0.55s" },
  { src: "/brand/marca-3.png", fx: "46px", fy: "26px", delay: "0.95s" },
];
const css = (v: Record<string, string | number>) => v as React.CSSProperties;

/** Painel de marca do login: nome EASY em destaque, logo animado, widgets ilustrativos e fundo em movimento. */
export function BrandPanel() {
  const ref = useRef<HTMLElement>(null);
  // paralaxe: as camadas se deslocam de leve conforme o mouse
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", String(((e.clientX - r.left) / r.width - 0.5) * 2));
    el.style.setProperty("--py", String(((e.clientY - r.top) / r.height - 0.5) * 2));
  };
  const onLeave = () => { ref.current?.style.setProperty("--px", "0"); ref.current?.style.setProperty("--py", "0"); };
  const layer = (x: number, y: number): React.CSSProperties => ({ transform: `translate3d(calc(var(--px, 0) * ${x}px), calc(var(--py, 0) * ${y}px), 0)` });

  return (
    <section
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className="brand-gradient sweep relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:items-center lg:justify-center"
    >
      {/* fundo em movimento */}
      <div aria-hidden className="grid-move pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_45%,black,transparent_75%)]" />
      <div aria-hidden className="pointer-events-none absolute -left-24 top-1/4 h-96 w-96 animate-drift rounded-full bg-brand-400/30 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-0 h-[28rem] w-[28rem] animate-drift rounded-full bg-accent-500/25 blur-3xl [animation-delay:-9s]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <svg aria-hidden viewBox="0 0 800 800" className="brand-layer pointer-events-none absolute left-1/2 top-[42%] w-[min(120%,980px)] -translate-x-1/2 -translate-y-1/2 opacity-70" style={layer(-8, -6)}>
        <circle cx="400" cy="400" r="190" fill="none" stroke="white" strokeOpacity=".07" />
        <circle cx="400" cy="400" r="260" fill="none" stroke="white" strokeOpacity=".06" />
        <circle cx="400" cy="400" r="330" fill="none" stroke="white" strokeOpacity=".05" />
        <g className="ring-spin"><circle cx="400" cy="400" r="225" fill="none" stroke="#F0703F" strokeOpacity=".4" strokeWidth="1.5" strokeDasharray="4 22" strokeLinecap="round" /></g>
        <g className="ring-spin-rev"><circle cx="400" cy="400" r="295" fill="none" stroke="white" strokeOpacity=".22" strokeWidth="1.5" strokeDasharray="2 30" strokeLinecap="round" /></g>
      </svg>
      {PARTICULAS.map((p, i) => (
        <span key={i} aria-hidden className="spark" style={css({ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, "--d": `${p.d}s`, "--l": `${p.l}s` })} />
      ))}
      {BRASAS.map((b, i) => (
        <span key={i} aria-hidden className="ember" style={css({ left: `${b.x}%`, "--d": `${b.d}s`, "--l": `${b.l}s` })} />
      ))}

      {/* centro: logo + nome EASY + slogan */}
      <div className="relative z-10 flex w-full max-w-[640px] flex-col items-center px-10 text-center">
        <div className="brand-layer" style={layer(10, 8)}>
          <div className="logo-float">
            <div className="logo-glow relative aspect-[428/335] w-[min(250px,26vw)]">
              {PARTES.map((m) => (
                <Image key={m.src} src={m.src} alt="" fill priority sizes="250px" className="logo-part object-contain" style={css({ "--fx": m.fx, "--fy": m.fy, animationDelay: m.delay })} />
              ))}
            </div>
          </div>
        </div>

        <h1 className="easy-in mt-9 w-full" aria-label="EASY Gestão Especializada que protege">
          <span aria-hidden className="easy-metal mx-auto block aspect-[1338/200] w-[min(560px,92%)]" />
        </h1>
        <p aria-hidden className="mt-6 flex flex-wrap items-center justify-center text-[19px] font-medium tracking-[0.04em] text-white/90 xl:text-[22px]">
          {[["Gestão", false], ["Especializada", false], ["que", true], ["protege", true]].map(([w, destaque], i) => (
            <span key={w as string} className={`slogan-word mr-[0.32em] ${destaque ? "text-gradient-light gradient-flow font-bold" : ""}`} style={{ animationDelay: `${1.9 + i * 0.16}s` }}>{w}</span>
          ))}
        </p>
        <span aria-hidden className="slogan-line mx-auto mt-6 block h-[3px] w-28 rounded-full bg-gradient-to-r from-accent-500 via-accent-300 to-accent-500" />
      </div>

      {/* selos de confiança */}
      <ul className="stagger absolute inset-x-0 bottom-9 z-10 flex flex-wrap justify-center gap-2.5 px-8 [&>*]:[animation-delay:3.4s]">
        {SELOS.map(({ icon: Icon, label }, i) => (
          <li key={label} style={{ animationDelay: `${3.4 + i * 0.12}s` }} className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-white/80">
            <Icon className="h-3.5 w-3.5 text-accent-300" /> {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
