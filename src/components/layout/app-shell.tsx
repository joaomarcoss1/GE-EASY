"use client";
import { useState } from "react";
import { Menu, Search } from "lucide-react";
import type { Profile } from "@/lib/types";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";
import { Notifications } from "./notifications";
import { ThemeToggle, UserMenu } from "./user-menu";

export function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  return (
    <div className="min-h-screen">
      <Sidebar role={profile.role} open={menu} onClose={() => setMenu(false)} />
      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl sm:px-6">
          <button className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={() => setPalette(true)}
            className="flex h-10 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 text-left text-sm text-muted shadow-sm transition hover:border-brand-300 sm:max-w-md"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 truncate">Buscar no sistema…</span>
            <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold sm:block">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Notifications userId={profile.id} />
            <div className="mx-1 hidden h-8 w-px bg-line sm:block" />
            <UserMenu profile={profile} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
      <CommandPalette role={profile.role} open={palette} setOpen={setPalette} />
    </div>
  );
}
