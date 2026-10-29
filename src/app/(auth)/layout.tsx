import Image from "next/image";

const PARTICULAS = [
  { x: 12, y: 18, s: 3, d: 4.2, l: 0 }, { x: 82, y: 14, s: 2, d: 5.1, l: 1.2 }, { x: 24, y: 70, s: 2, d: 3.8, l: 0.6 },
  { x: 70, y: 76, s: 3, d: 4.6, l: 2.1 }, { x: 90, y: 48, s: 2, d: 5.4, l: 0.9 }, { x: 8, y: 44, s: 2, d: 4.9, l: 1.8 },
  { x: 48, y: 8, s: 2, d: 4.1, l: 2.6 }, { x: 58, y: 90, s: 3, d: 5.6, l: 0.3 }, { x: 36, y: 30, s: 2, d: 3.9, l: 1.5 },
];
const BRASAS = [
  { x: 18, d: 9, l: 0 }, { x: 34, d: 11, l: 3 }, { x: 52, d: 8, l: 5 }, { x: 66, d: 10, l: 1.5 }, { x: 80, d: 12, l: 6.5 }, { x: 90, d: 9.5, l: 4 },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-gradient sweep relative hidden overflow-hidden text-white lg:flex lg:items-center lg:justify-center">
        {/* fundo em movimento: grade deslizando, orbes, anéis e partículas */}
        <div aria-hidden className="grid-move pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_50%_45%,black,transparent_75%)]" />
        <div aria-hidden className="pointer-events-none absolute -left-24 top-1/4 h-96 w-96 animate-drift rounded-full bg-brand-400/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 right-0 h-[28rem] w-[28rem] animate-drift rounded-full bg-accent-500/25 blur-3xl [animation-delay:-9s]" />
        <svg aria-hidden viewBox="0 0 800 800" className="pointer-events-none absolute left-1/2 top-[44%] w-[min(120%,980px)] -translate-x-1/2 -translate-y-1/2 opacity-70">
          <circle cx="400" cy="400" r="190" fill="none" stroke="white" strokeOpacity=".07" />
          <circle cx="400" cy="400" r="260" fill="none" stroke="white" strokeOpacity=".06" />
          <circle cx="400" cy="400" r="330" fill="none" stroke="white" strokeOpacity=".05" />
          <g className="ring-spin"><circle cx="400" cy="400" r="225" fill="none" stroke="#F0703F" strokeOpacity=".35" strokeWidth="1.5" strokeDasharray="4 22" strokeLinecap="round" /></g>
          <g className="ring-spin-rev"><circle cx="400" cy="400" r="295" fill="none" stroke="white" strokeOpacity=".22" strokeWidth="1.5" strokeDasharray="2 30" strokeLinecap="round" /></g>
        </svg>
        {PARTICULAS.map((p, i) => (
          <span key={i} aria-hidden className="spark" style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.s, height: p.s, ["--d" as string]: `${p.d}s`, ["--l" as string]: `${p.l}s` }} />
        ))}
        {BRASAS.map((b, i) => (
          <span key={i} aria-hidden className="ember" style={{ left: `${b.x}%`, ["--d" as string]: `${b.d}s`, ["--l" as string]: `${b.l}s` }} />
        ))}

        <div className="relative z-10 flex flex-col items-center px-12 text-center">
          {/* marca: cada parte entra de um lado, depois o conjunto flutua e brilha */}
          <div className="logo-float">
            <div className="logo-glow relative aspect-[428/335] w-[min(340px,34vw)]">
              {[
                { src: "/brand/marca-2.png", fx: "-46px", fy: "-18px", delay: "0.15s" },
                { src: "/brand/marca-1.png", fx: "-30px", fy: "36px", delay: "0.55s" },
                { src: "/brand/marca-3.png", fx: "46px", fy: "26px", delay: "0.95s" },
              ].map((m) => (
                <Image
                  key={m.src}
                  src={m.src}
                  alt=""
                  fill
                  priority
                  sizes="340px"
                  className="logo-part object-contain"
                  style={{ ["--fx" as string]: m.fx, ["--fy" as string]: m.fy, animationDelay: m.delay }}
                />
              ))}
              <span className="sr-only">EASY</span>
            </div>
          </div>

          {/* slogan */}
          <p className="mt-12 text-[28px] font-semibold leading-snug tracking-tight xl:text-[32px]" aria-label="EASY Gestão Especializada que protege">
            <span aria-hidden>
              {[["EASY", false], ["Gestão", false], ["Especializada", false], ["que", true], ["protege", true]].map(([w, destaque], i) => (
                <span
                  key={w as string}
                  className={`slogan-word mr-[0.28em] ${destaque ? "text-gradient-light gradient-flow font-bold" : ""}`}
                  style={{ animationDelay: `${1.5 + i * 0.16}s` }}
                >
                  {w}
                </span>
              ))}
            </span>
          </p>
          <span aria-hidden className="slogan-line mt-5 block h-[3px] w-24 rounded-full bg-gradient-to-r from-accent-500 to-accent-300" />
        </div>
      </section>
      <section className="relative flex items-center justify-center overflow-hidden px-5 py-12 sm:px-10">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-accent-500/10 blur-3xl" />
        <div className="reveal relative w-full max-w-[420px] rounded-3xl border border-line bg-surface/80 p-7 shadow-lift backdrop-blur-xl sm:p-9">
          <div className="mb-8 flex justify-center lg:hidden">
            <Image src="/brand/logo-wordmark-dark.png" alt="EASY Gestão Especializada" width={1071} height={308} priority className="h-auto w-[210px] dark:hidden" />
            <Image src="/brand/logo-wordmark-transparent.png" alt="EASY Gestão Especializada" width={1071} height={308} priority className="hidden h-auto w-[210px] dark:block" />
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
