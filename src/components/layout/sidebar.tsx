"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, ListChecks, Users, KanbanSquare, Landmark, ShieldCheck, MapPin, Wallet, Target,
  BriefcaseBusiness, FolderOpen, BarChart3, Settings, X, Scale, AlarmClock, Gavel, Building2, TrendingUp, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { NAV } from "@/lib/nav";
import { can } from "@/lib/rbac";
import type { AppRole } from "@/lib/types";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, CalendarDays, ListChecks, Users, KanbanSquare, Landmark, ShieldCheck, MapPin, Wallet, Target, BriefcaseBusiness, FolderOpen, BarChart3, Settings,
  Scale, AlarmClock, Gavel, Building2, TrendingUp,
};

export function Sidebar({ role, open, onClose }: { role: AppRole; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-brand-950/60 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          "brand-gradient fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col text-white transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-5">
          <Link href="/dashboard" className="block" onClick={onClose}>
            <Image src="/brand/logo-wordmark-transparent.png" alt="EASY Consórcio & Seguros" width={170} height={62} priority className="h-auto w-[168px]" />
          </Link>
          <button className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 lg:hidden" onClick={onClose} aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-5 mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
          GE <span className="text-accent-300">EASY</span> · Gestão Jurídica
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Menu principal">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.permission || can(role, i.permission));
            if (!items.length) return null;
            return (
              <div key={group.label}>
                <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/40">{group.label}</p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = ICONS[item.icon] ?? LayoutDashboard;
                    const active = pathname === item.href || pathname.startsWith(item.href + "/");
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition",
                            active ? "bg-white text-brand-800 shadow-lg shadow-brand-950/30" : "text-white/75 hover:bg-white/10 hover:text-white",
                          )}
                        >
                          {active && <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent-500" />}
                          <Icon className={cn("h-[18px] w-[18px]", active ? "text-accent-500" : "text-white/60 group-hover:text-white")} />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[11px] text-white/45">© {new Date().getFullYear()} EASY Consórcio & Seguros</div>
      </aside>
    </>
  );
}
