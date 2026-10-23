import type { Permission } from "@/lib/rbac";
import type { Area } from "@/lib/types";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: Permission;
  /** Só para o administrador master da empresa */
  master?: boolean;
  /** Só para o dono da plataforma */
  plataforma?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Grupo recolhido por padrão no menu (módulos secundários) */
  collapsed?: boolean;
  /** Área (departamento) do grupo; sem área = itens gerais, sempre visíveis */
  area?: Area;
}

/** Rotas ainda em construção (ocultas do menu até a página existir) */
const EM_CONSTRUCAO = new Set<string>([]);

/**
 * Menu por área de trabalho (entrada por departamento). Com uma área escolhida, o menu mostra os itens
 * gerais + os da área; sem escolha, todas as áreas a que o usuário tem acesso. O menu só organiza a
 * interface: cada item continua exigindo a funcionalidade no servidor e no banco.
 */
const ALL_NAV: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Painel geral", icon: "LayoutDashboard" },
      { href: "/agenda", label: "Agenda", icon: "CalendarDays" },
      { href: "/tarefas", label: "Tarefas e demandas", icon: "ListChecks" },
      { href: "/ponto", label: "Meu ponto", icon: "Clock", permission: "ponto.registrar" },
    ],
  },
  {
    label: "Consultor",
    area: "consultor",
    items: [
      { href: "/consultor", label: "Minha carteira", icon: "BriefcaseBusiness", permission: "clientes.view" },
      { href: "/campo", label: "App de campo", icon: "Smartphone", permission: "rotas.executar" },
      { href: "/rotas", label: "Minhas rotas", icon: "Route", permission: "rotas.executar" },
      { href: "/leads", label: "Meus leads", icon: "UserPlus", permission: "leads.view" },
      { href: "/whatsapp", label: "WhatsApp", icon: "MessageCircle", permission: "whatsapp.atender" },
      { href: "/clientes", label: "Clientes", icon: "Users", permission: "clientes.view" },
      { href: "/visitas", label: "Visitas & check-in", icon: "MapPin", permission: "visitas.checkin" },
      { href: "/oportunidades", label: "Funil de vendas", icon: "KanbanSquare", permission: "comercial.view" },
      { href: "/consorcios", label: "Consórcios", icon: "Landmark", permission: "comercial.view" },
      { href: "/seguros", label: "Seguros", icon: "ShieldCheck", permission: "comercial.view" },
      { href: "/comissoes", label: "Comissões", icon: "BadgePercent", permission: "comissoes.view" },
      { href: "/metas", label: "Metas & ranking", icon: "Target", permission: "comercial.view" },
      { href: "/comercial", label: "Painel comercial", icon: "TrendingUp", permission: "comercial.view" },
      { href: "/consultores", label: "Consultores externos", icon: "UserCheck", permission: "consultores.manage" },
    ],
  },
  {
    label: "Administrativo",
    area: "administrativo",
    items: [
      { href: "/administrativo", label: "Painel administrativo", icon: "ClipboardList", permission: "clientes.ver_todos" },
      { href: "/administrativo/documentacao", label: "Central de documentação", icon: "FileCheck2", permission: "documentacao.analisar" },
      { href: "/administrativo/base", label: "Base de clientes", icon: "Database", permission: "clientes.ver_todos" },
      { href: "/rotas", label: "Rotas", icon: "Route", permission: "rotas.ver" },
      { href: "/rotas/mapa", label: "Mapa do campo", icon: "Map", permission: "rotas.ver" },
      { href: "/rotas/despesas", label: "Despesas de rota", icon: "Receipt", permission: "despesas.aprovar" },
      { href: "/leads", label: "Leads", icon: "UserPlus", permission: "leads.distribuir" },
      { href: "/whatsapp", label: "WhatsApp", icon: "MessageCircle", permission: "whatsapp.atender" },
      { href: "/whatsapp/campanhas", label: "Campanhas de WhatsApp", icon: "Megaphone", permission: "whatsapp.campanhas" },
      { href: "/whatsapp/metricas", label: "Métricas de atendimento", icon: "PieChart", permission: "whatsapp.supervisionar" },
      { href: "/clientes", label: "Clientes", icon: "Users", permission: "clientes.view" },
      { href: "/atendimentos", label: "Atendimentos", icon: "MessagesSquare", permission: "atendimentos.view" },
      { href: "/documentos", label: "Documentos", icon: "FolderOpen" },
      { href: "/modelos", label: "Modelos de documentos", icon: "FileSignature", permission: "modelos.view" },
    ],
  },
  {
    label: "Jurídico",
    area: "juridico",
    items: [
      { href: "/juridico", label: "Painel jurídico", icon: "Scale", permission: "processos.view" },
      { href: "/processos", label: "Processos", icon: "Gavel", permission: "processos.view" },
      { href: "/publicacoes", label: "Publicações", icon: "Newspaper", permission: "publicacoes.view" },
      { href: "/prazos", label: "Prazos", icon: "AlarmClock", permission: "processos.view" },
      { href: "/audiencias", label: "Audiências", icon: "CalendarClock", permission: "processos.view" },
      { href: "/atendimentos", label: "Atendimentos", icon: "MessagesSquare", permission: "atendimentos.view" },
      { href: "/clientes", label: "Clientes", icon: "Users", permission: "clientes.view" },
      { href: "/contratos", label: "Contratos de honorários", icon: "FileText", permission: "contratos.view" },
      { href: "/horas", label: "Controle de horas", icon: "Timer", permission: "horas.lancar" },
      { href: "/modelos", label: "Modelos de documentos", icon: "FileSignature", permission: "modelos.view" },
      { href: "/documentos", label: "Documentos", icon: "FolderOpen" },
    ],
  },
  {
    label: "RH",
    area: "rh",
    items: [
      { href: "/rh", label: "Funcionários", icon: "IdCard", permission: "rh.funcionarios.ver" },
      { href: "/ponto?tab=aprovacoes", label: "Gestão do ponto", icon: "CalendarCheck", permission: "ponto.gerir" },
      { href: "/rh/folha", label: "Pré-folha", icon: "FileSpreadsheet", permission: "folha.gerir" },
      { href: "/departamentos", label: "Departamentos", icon: "Building2", permission: "departamentos.view" },
    ],
  },
  {
    label: "Financeiro",
    area: "financeiro",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: "Wallet", permission: "financeiro.view" },
      { href: "/contratos", label: "Contratos de honorários", icon: "FileText", permission: "contratos.view" },
      { href: "/comissoes", label: "Comissões", icon: "BadgePercent", permission: "comissoes.view" },
      { href: "/horas", label: "Controle de horas", icon: "Timer", permission: "horas.lancar" },
      { href: "/relatorios", label: "Relatórios", icon: "BarChart3", permission: "relatorios.view" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/acessos", label: "Acessos", icon: "KeyRound", master: true },
      { href: "/auditoria", label: "Auditoria", icon: "History", permission: "auditoria.view" },
      { href: "/lixeira", label: "Lixeira", icon: "Trash2", permission: "lixeira.gerir" },
      { href: "/whatsapp/configuracao", label: "WhatsApp e Lead Ads", icon: "MessageCircle", permission: "whatsapp.configurar" },
      { href: "/departamentos", label: "Departamentos", icon: "Building2", permission: "departamentos.manage" },
      { href: "/configuracoes", label: "Configurações", icon: "Settings" },
      { href: "/plataforma", label: "Plataforma", icon: "Globe", plataforma: true },
    ],
  },
];

export const NAV: NavGroup[] = ALL_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !EM_CONSTRUCAO.has(i.href)) }));

interface Acesso {
  permissoes?: readonly string[];
  admin_master?: boolean;
}

/** Itens visíveis para o usuário (permissão, master, plataforma). */
export function itemVisivel(i: NavItem, acesso: Acesso, plataformaAdmin: boolean) {
  if (i.plataforma) return plataformaAdmin;
  if (i.master) return !!acesso.admin_master;
  return !i.permission || !!acesso.permissoes?.includes(i.permission);
}

/** Grupos do menu para a área ativa (ou todas as áreas do usuário, se nenhuma foi escolhida). */
export function menuDaArea(acesso: Acesso, areas: readonly Area[], areaAtiva: Area | null, plataformaAdmin: boolean): NavGroup[] {
  const vistos = new Set<string>(); // o mesmo link em várias áreas aparece uma vez só
  return NAV.filter((g) => !g.area || (areaAtiva ? g.area === areaAtiva : areas.includes(g.area)))
    .map((g) => ({ ...g, items: g.items.filter((i) => itemVisivel(i, acesso, plataformaAdmin) && !vistos.has(i.href) && !!vistos.add(i.href)) }))
    .filter((g) => g.items.length > 0);
}
