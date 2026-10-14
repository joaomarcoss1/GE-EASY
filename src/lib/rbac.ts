import type { AppRole } from "./types";

/**
 * Matriz de permissões da interface. A autorização REAL é aplicada no banco
 * (RLS + triggers); estas regras apenas escondem ações que o usuário não pode
 * executar e validam as Server Actions antes de chegar ao banco.
 */
export const PERMISSIONS = {
  "dashboard.view": ["admin", "gestor", "financeiro", "advogado", "assistente_juridico", "consultor", "consultor_externo"],
  "clientes.view": ["admin", "gestor", "financeiro", "advogado", "assistente_juridico", "consultor", "consultor_externo"],
  "clientes.write": ["admin", "gestor", "advogado", "assistente_juridico", "consultor", "consultor_externo"],
  "processos.view": ["admin", "gestor", "financeiro", "advogado", "assistente_juridico"],
  "processos.write": ["admin", "gestor", "advogado", "assistente_juridico"],
  "processos.delete": ["admin", "gestor"],
  "processos.financeiro": ["admin", "gestor", "financeiro", "advogado"],
  "departamentos.view": ["admin", "gestor", "financeiro", "advogado", "assistente_juridico", "consultor", "consultor_externo"],
  "departamentos.manage": ["admin", "gestor"],
  "comercial.view": ["admin", "gestor", "financeiro", "consultor", "consultor_externo"],
  "clientes.delete": ["admin", "gestor"],
  "clientes.transfer": ["admin", "gestor"],
  "negocios.write": ["admin", "gestor", "consultor", "consultor_externo"],
  "negocios.delete": ["admin", "gestor"],
  "comissoes.view": ["admin", "gestor", "financeiro", "consultor", "consultor_externo"],
  "comissoes.manage": ["admin", "gestor", "financeiro"],
  "metas.manage": ["admin", "gestor"],
  "consultores.manage": ["admin", "gestor"],
  "relatorios.view": ["admin", "gestor", "financeiro"],
  "cadastros.manage": ["admin", "gestor"],
  "usuarios.manage": ["admin"],
  "auditoria.view": ["admin"],
  "visitas.checkin": ["consultor", "consultor_externo", "gestor", "admin"],
} as const satisfies Record<string, readonly AppRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly AppRole[]).includes(role);
}

export const isJuridicoRole = (role: AppRole) => ["admin", "gestor", "advogado", "assistente_juridico"].includes(role);
export const isManagerRole = (role: AppRole) => role === "admin" || role === "gestor";
export const isBackofficeRole = (role: AppRole) => role === "admin" || role === "gestor" || role === "financeiro";
