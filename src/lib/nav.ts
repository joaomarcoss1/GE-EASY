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

export const NAV: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Painel", icon: "LayoutDashboard" },
      { href: "/agenda", label: "Agenda", icon: "CalendarDays" },
      { href: "/tarefas", label: "Tarefas", icon: "ListChecks" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/clientes", label: "Clientes", icon: "Users" },
      { href: "/oportunidades", label: "Funil de vendas", icon: "KanbanSquare" },
      { href: "/consorcios", label: "Consórcios", icon: "Landmark" },
      { href: "/seguros", label: "Seguros", icon: "ShieldCheck" },
    ],
  },
  {
    label: "Campo",
    items: [{ href: "/visitas", label: "Visitas & check-in", icon: "MapPin", permission: "visitas.checkin" }],
  },
  {
    label: "Financeiro",
    items: [
      { href: "/comissoes", label: "Comissões", icon: "Wallet", permission: "comissoes.view" },
      { href: "/metas", label: "Metas & ranking", icon: "Target" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/consultores", label: "Consultores", icon: "BriefcaseBusiness", permission: "consultores.manage" },
      { href: "/documentos", label: "Documentos", icon: "FolderOpen" },
      { href: "/relatorios", label: "Relatórios", icon: "BarChart3", permission: "relatorios.view" },
    ],
  },
  {
    label: "Sistema",
    items: [{ href: "/configuracoes", label: "Configurações", icon: "Settings" }],
  },
];
