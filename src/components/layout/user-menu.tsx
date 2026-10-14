"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LogOut, UserCog, ShieldCheck, Moon, Sun } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ROLE_LABEL } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { signOut } from "@/lib/actions/auth";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ge-theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button onClick={toggle} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label="Alternar tema">
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export function UserMenu({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 hover:bg-surface-2" aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={profile.full_name} src={profile.avatar_url} size={34} />
        <span className="hidden text-left md:block">
          <span className="block max-w-[160px] truncate text-sm font-semibold leading-tight">{profile.full_name}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[profile.role]}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-60 animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop" role="menu">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-semibold">{profile.full_name}</p>
            <p className="truncate text-xs text-muted">{profile.email}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link href="/configuracoes?tab=perfil" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-surface-2" role="menuitem">
            <UserCog className="h-4 w-4 text-muted" /> Meu perfil
          </Link>
          <Link href="/configuracoes?tab=seguranca" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-surface-2" role="menuitem">
            <ShieldCheck className="h-4 w-4 text-muted" /> Segurança e 2FA
          </Link>
          <div className="my-1 h-px bg-line" />
          <form action={signOut}>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" role="menuitem">
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
