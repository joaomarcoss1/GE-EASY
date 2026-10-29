"use client";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import type { Area, EmpresaResumo, Profile } from "@/lib/types";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { Notifications } from "./notifications";
import { ThemeToggle, UserMenu } from "./user-menu";
import { EmpresaSwitcher } from "./empresa-switcher";
import { PageEffects } from "./page-effects";

export function AppShell({
  profile,
  empresa,
  empresas,
  areas,
  areaAtiva,
  plataformaAdmin,
  children,
}: {
  profile: Profile;
  empresa: EmpresaResumo;
  empresas: EmpresaResumo[];
  areas: Area[];
  areaAtiva: Area | null;
  plataformaAdmin: boolean;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <PageEffects />
      <Sidebar profile={profile} areas={areas} areaInicial={areaAtiva} plataformaAdmin={plataformaAdmin} empresaNome={empresa.nome} logoUrl={empresa.marca?.logo_url ?? null} open={menu} onClose={() => setMenu(false)} />
      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line/70 bg-bg/70 px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6">
          <button className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </button>
          {/* no celular a busca vira só o ícone: o cabeçalho não cabe numa linha com o campo */}
          <button
            onClick={() => setPalette(true)}
            aria-label="Buscar no sistema"
            className="flex h-10 w-10 shrink-0 items-center justify-center gap-2.5 rounded-xl border border-line bg-surface text-left text-sm text-muted shadow-sm transition-all duration-200 hover:border-brand-300 hover:shadow-md focus-visible:shadow-md sm:w-auto sm:max-w-md sm:flex-1 sm:justify-start sm:px-3.5"
          >
            <Search className="h-4 w-4" />
            <span className="hidden flex-1 truncate sm:block">Buscar no sistema…</span>
            <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold sm:block">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {empresas.length > 1 && <EmpresaSwitcher atual={empresa.id} empresas={empresas} />}
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <Notifications userId={profile.id} />
            <div className="mx-1 hidden h-8 w-px bg-line sm:block" />
            <UserMenu profile={profile} trocarEmpresa={empresas.length > 1} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {/* a chave recria o bloco a cada tela, para a animação de entrada rodar na navegação */}
          <div key={pathname} className="page-enter">{children}</div>
        </main>
      </div>
      <CommandPalette profile={profile} areas={areas} plataformaAdmin={plataformaAdmin} open={palette} setOpen={setPalette} />
    </div>
  );
}
