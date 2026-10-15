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
  /** Grupo recolhido por padrão no menu (módulos secundários) */
  collapsed?: boolean;
}

/**
 * Menu principal — sistema de gestão de escritório de advocacia.
 * Jurídico e administração do escritório em primeiro plano; o comercial
 * (consórcios e seguros) fica em um grupo recolhido.
 */
/** Rotas ainda em construção (ocultas do menu até a página existir) */
const EM_CONSTRUCAO = new Set<string>([]);

const ALL_NAV: NavGroup[] = [
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
      { href: "/publicacoes", label: "Publicações", icon: "Newspaper", permission: "publicacoes.view" },
      { href: "/prazos", label: "Prazos", icon: "AlarmClock", permission: "processos.view" },
      { href: "/audiencias", label: "Audiências", icon: "Gavel", permission: "processos.view" },
      { href: "/atendimentos", label: "Atendimentos", icon: "MessagesSquare", permission: "atendimentos.view" },
      { href: "/clientes", label: "Clientes", icon: "Users" },
      { href: "/modelos", label: "Modelos de documentos", icon: "FileSignature", permission: "modelos.view" },
      { href: "/documentos", label: "Documentos", icon: "FolderOpen" },
    ],
  },
  {
    label: "Escritório",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: "Wallet", permission: "financeiro.view" },
      { href: "/contratos", label: "Contratos de honorários", icon: "FileText", permission: "contratos.view" },
      { href: "/horas", label: "Controle de horas", icon: "Timer", permission: "horas.lancar" },
      { href: "/departamentos", label: "Departamentos", icon: "Building2", permission: "departamentos.view" },
      { href: "/relatorios", label: "Relatórios", icon: "BarChart3", permission: "relatorios.view" },
    ],
  },
  {
    label: "Comercial · Consórcios & Seguros",
    collapsed: true,
    items: [
      { href: "/comercial", label: "Painel comercial", icon: "TrendingUp", permission: "comercial.view" },
      { href: "/oportunidades", label: "Funil de vendas", icon: "KanbanSquare", permission: "comercial.view" },
      { href: "/consorcios", label: "Consórcios", icon: "Landmark", permission: "comercial.view" },
      { href: "/seguros", label: "Seguros", icon: "ShieldCheck", permission: "comercial.view" },
      { href: "/comissoes", label: "Comissões", icon: "BadgePercent", permission: "comissoes.view" },
      { href: "/metas", label: "Metas & ranking", icon: "Target", permission: "comercial.view" },
      { href: "/visitas", label: "Visitas & check-in", icon: "MapPin", permission: "visitas.checkin" },
      { href: "/consultores", label: "Consultores externos", icon: "BriefcaseBusiness", permission: "consultores.manage" },
    ],
  },
  {
    label: "Sistema",
    items: [{ href: "/configuracoes", label: "Configurações", icon: "Settings" }],
  },
];

export const NAV: NavGroup[] = ALL_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !EM_CONSTRUCAO.has(i.href)) }));
