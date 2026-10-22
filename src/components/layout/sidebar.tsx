"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, ListChecks, Users, KanbanSquare, Landmark, ShieldCheck, MapPin, Wallet, Target,
  BriefcaseBusiness, FolderOpen, BarChart3, Settings, X, Scale, AlarmClock, Gavel, Building2, TrendingUp,
  Newspaper, MessagesSquare, FileSignature, FileText, Timer, BadgePercent, ChevronDown, UserCheck, ClipboardList,
  FileCheck2, Database, CalendarClock, IdCard, KeyRound, History, Trash2, Globe, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { AREAS } from "@/lib/constants";
import { menuDaArea } from "@/lib/nav";
import { areaDoCaminho } from "@/lib/tenant";
import type { Area, Profile } from "@/lib/types";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, CalendarDays, ListChecks, Users, KanbanSquare, Landmark, ShieldCheck, MapPin, Wallet, Target, BriefcaseBusiness, FolderOpen, BarChart3, Settings,
  Scale, AlarmClock, Gavel, Building2, TrendingUp, Newspaper, MessagesSquare, FileSignature, FileText, Timer, BadgePercent, UserCheck, ClipboardList,
  FileCheck2, Database, CalendarClock, IdCard, KeyRound, History, Trash2, Globe,
};

export function Sidebar({
  profile,
  areas,
  areaInicial,
  plataformaAdmin,
  empresaNome,
  open,
  onClose,
}: {
  profile: Pick<Profile, "permissoes" | "admin_master">;
  areas: Area[];
  areaInicial: Area | null;
  plataformaAdmin: boolean;
  empresaNome: string;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [areaAtiva, setAreaAtiva] = useState<Area | null>(areaInicial);
  // a área muda ao entrar pela URL do departamento e permanece nas telas comuns (clientes, agenda...)
  useEffect(() => {
    const a = areaDoCaminho(pathname);
    if (a && areas.includes(a)) setAreaAtiva(a);
  }, [pathname, areas]);
  const grupos = menuDaArea(profile, areas, areas.length > 1 ? areaAtiva : null, plataformaAdmin);

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
          <Link href="/inicio" className="block" onClick={onClose}>
            <Image src="/brand/logo-wordmark-transparent.png" alt="GE EASY" width={170} height={62} priority className="h-auto w-[168px]" />
          </Link>
          <button className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 lg:hidden" onClick={onClose} aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mx-5 mb-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
            GE <span className="text-accent-300">EASY</span> · Gestão
          </p>
          <p className="mt-0.5 truncate text-xs font-medium text-white/90" title={empresaNome}>{empresaNome}</p>
        </div>
        {areas.length > 1 && (
          <nav className="mx-3 mb-4 flex flex-wrap gap-1.5 px-2" aria-label="Área de trabalho">
            {AREAS.filter((a) => areas.includes(a.value)).map((a) => (
              <Link
                key={a.value}
                href={a.href}
                onClick={onClose}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                  areaAtiva === a.value ? "bg-white text-brand-800" : "bg-white/10 text-white/80 hover:bg-white/20",
                )}
                aria-current={areaAtiva === a.value ? "page" : undefined}
              >
                {a.label}
              </Link>
            ))}
          </nav>
        )}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Menu principal">
          {grupos.map((group) => {
            const items = group.items;
            const hasActive = items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
            const isOpen = !group.collapsed || hasActive || expanded[group.label];
            return (
              <div key={group.label}>
                {group.collapsed ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => ({ ...e, [group.label]: !isOpen }))}
                    className="flex w-full items-center justify-between rounded-lg px-3 pb-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/40 hover:text-white/70"
                    aria-expanded={isOpen}
                  >
                    {group.label}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-180")} />
                  </button>
                ) : (
                  <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/40">{group.label}</p>
                )}
                {isOpen && <ul className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = ICONS[item.icon] ?? LayoutDashboard;
                    const active = pathname === item.href || (item.href !== "/administrativo" && pathname.startsWith(item.href + "/"));
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
                </ul>}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[11px] text-white/45">© {new Date().getFullYear()} GE EASY</div>
      </aside>
    </>
  );
}
