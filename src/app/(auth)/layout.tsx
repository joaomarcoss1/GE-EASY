import Image from "next/image";
import { BrandPanel } from "./brand-panel";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
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
