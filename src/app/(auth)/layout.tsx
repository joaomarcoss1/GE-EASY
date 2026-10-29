import Image from "next/image";
import { ShieldCheck, CalendarDays, Scale, Building2 } from "lucide-react";

const highlights = [
  { icon: Scale, title: "Jurídico integrado", text: "Processos, andamentos, custas e honorários em um só lugar." },
  { icon: CalendarDays, title: "Prazos e audiências", text: "Contagem em dias úteis (CPC), alertas e Google Agenda." },
  { icon: Building2, title: "Por departamentos", text: "Consultor, administrativo, RH e financeiro com indicadores próprios." },
  { icon: ShieldCheck, title: "Segurança total", text: "Controle de acesso por perfil, 2FA e auditoria de alterações." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        {/* fundo animado: grade, orbes que flutuam e anéis da marca */}
        <div aria-hidden className="dots pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_30%_20%,black,transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute -left-24 top-1/3 h-80 w-80 animate-drift rounded-full bg-brand-400/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 right-0 h-96 w-96 animate-drift rounded-full bg-accent-500/25 blur-3xl [animation-delay:-8s]" />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] animate-float-slow rounded-full border-[60px] border-accent-500/15" />
        <div aria-hidden className="pointer-events-none absolute -bottom-52 -left-32 h-[560px] w-[560px] rounded-full border-[48px] border-white/[0.04]" />
        <Image src="/brand/logo-wordmark-transparent.png" alt="EASY Gestão Especializada" width={1071} height={308} priority className="reveal relative h-auto w-[250px] drop-shadow-[0_8px_24px_rgba(0,0,0,0.25)]" />
        <div className="relative mt-auto max-w-lg">
          <p className="reveal mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent-200 backdrop-blur [animation-delay:120ms]">
            <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-accent-400" /> GE EASY
          </p>
          <h1 className="reveal text-4xl font-bold leading-tight tracking-tight [animation-delay:200ms]">
            Gestão Especializada <span className="text-gradient-light gradient-flow">EASY</span>
          </h1>
          <p className="reveal mt-4 text-base text-white/70 [animation-delay:280ms]">A plataforma de gestão da EASY: clientes, equipes, processos, prazos e financeiro organizados por departamento, com o comercial de consórcios e seguros integrado.</p>
          <div className="stagger mt-10 grid grid-cols-2 gap-4 [&>*]:[animation-delay:360ms]">
            {highlights.map(({ icon: Icon, title, text }, i) => (
              <div
                key={title}
                style={{ animationDelay: `${380 + i * 90}ms` }}
                className="glass group rounded-2xl p-4 transition duration-300 ease-smooth hover:-translate-y-1 hover:border-white/25 hover:bg-white/10"
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-500/15 ring-1 ring-inset ring-accent-400/30 transition duration-300 group-hover:scale-110 group-hover:bg-accent-500/25">
                  <Icon className="h-[18px] w-[18px] text-accent-300" />
                </span>
                <p className="mt-3 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/60">{text}</p>
              </div>
            ))}
          </div>
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
