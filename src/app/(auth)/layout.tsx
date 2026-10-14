import Image from "next/image";
import { ShieldCheck, CalendarDays, Landmark, Users } from "lucide-react";

const highlights = [
  { icon: Users, title: "CRM completo", text: "Carteira, funil de vendas e linha do tempo de cada cliente." },
  { icon: Landmark, title: "Consórcio & Seguros", text: "Cotas, lances, contemplações, apólices, renovações e sinistros." },
  { icon: CalendarDays, title: "Agenda + Google", text: "Sincronização com Google Agenda e documentos no Google Drive." },
  { icon: ShieldCheck, title: "Segurança total", text: "Controle de acesso por perfil, 2FA e auditoria de alterações." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border-[60px] border-accent-500/15" />
        <div className="pointer-events-none absolute -bottom-52 -left-32 h-[560px] w-[560px] rounded-full border-[48px] border-white/[0.04]" />
        <Image src="/brand/logo-wordmark-transparent.png" alt="EASY Consórcio & Seguros" width={230} height={84} priority className="relative h-auto w-[220px]" />
        <div className="relative mt-auto max-w-lg">
          <p className="mb-3 inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent-200">GE EASY</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Gestão Especializada <span className="text-accent-400">EASY</span>
          </h1>
          <p className="mt-4 text-base text-white/70">A plataforma que conecta escritório e consultores externos — do primeiro contato à comissão paga.</p>
          <div className="mt-10 grid grid-cols-2 gap-4">
            {highlights.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <Icon className="h-5 w-5 text-accent-400" />
                <p className="mt-3 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/60">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex justify-center lg:hidden">
            <Image src="/brand/logo-circle.png" alt="EASY" width={96} height={96} priority className="rounded-full shadow-pop" />
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}
