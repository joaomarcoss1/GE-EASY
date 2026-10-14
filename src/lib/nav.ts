import type { Permission } from "@/lib/rbac";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: Permission;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Menu principal: o núcleo jurídico e a gestão por departamentos vêm primeiro; o comercial é secundário. */
export const NAV: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Painel", icon: "LayoutDashboard" },
      { href: "/agenda", label: "Agenda", icon: "CalendarDays" },
      { href: "/tarefas", label: "Tarefas e demandas", icon: "ListChecks" },
    ],
  },
  {
    label: "Jurídico",
    items: [
      { href: "/processos", label: "Processos", icon: "Scale", permission: "processos.view" },
      { href: "/prazos", label: "Prazos", icon: "AlarmClock", permission: "processos.view" },
      { href: "/audiencias", label: "Audiências", icon: "Gavel", permission: "processos.view" },
      { href: "/clientes", label: "Clientes", icon: "Users" },
      { href: "/documentos", label: "Documentos", icon: "FolderOpen" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/departamentos", label: "Departamentos", icon: "Building2", permission: "departamentos.view" },
      { href: "/relatorios", label: "Relatórios", icon: "BarChart3", permission: "relatorios.view" },
      { href: "/consultores", label: "Equipe externa", icon: "BriefcaseBusiness", permission: "consultores.manage" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/comercial", label: "Painel comercial", icon: "TrendingUp", permission: "comercial.view" },
      { href: "/oportunidades", label: "Funil de vendas", icon: "KanbanSquare", permission: "comercial.view" },
      { href: "/consorcios", label: "Consórcios", icon: "Landmark", permission: "comercial.view" },
      { href: "/seguros", label: "Seguros", icon: "ShieldCheck", permission: "comercial.view" },
      { href: "/comissoes", label: "Comissões", icon: "Wallet", permission: "comissoes.view" },
      { href: "/metas", label: "Metas & ranking", icon: "Target", permission: "comercial.view" },
      { href: "/visitas", label: "Visitas & check-in", icon: "MapPin", permission: "visitas.checkin" },
    ],
  },
  {
    label: "Sistema",
    items: [{ href: "/configuracoes", label: "Configurações", icon: "Settings" }],
  },
];
