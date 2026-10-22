/**
 * Funcionalidades do sistema (catálogo em public.funcionalidades). Cada usuário recebe as suas pelos
 * níveis dos departamentos + exceções individuais, definidas pelo administrador master (tela Acessos).
 * A autorização REAL é aplicada no banco (RLS com tem_permissao() + regras de escopo); aqui as mesmas
 * chaves escondem o que o usuário não pode fazer e validam as Server Actions antes de chegar ao banco.
 */
export const FUNCIONALIDADES = [
  "dashboard.view",
  "clientes.view",
  "clientes.write",
  "clientes.delete",
  "clientes.ver_todos",
  "clientes.transfer",
  "clientes.exportar",
  "documentacao.analisar",
  "documentacao.prorrogar",
  "juridico.encaminhar",
  "cadastros.manage",
  "lgpd.exportar",
  "comercial.view",
  "negocios.write",
  "negocios.delete",
  "visitas.checkin",
  "comissoes.view",
  "metas.manage",
  "consultores.manage",
  "processos.view",
  "processos.write",
  "processos.delete",
  "publicacoes.view",
  "atendimentos.view",
  "contratos.view",
  "contratos.write",
  "horas.lancar",
  "modelos.view",
  "modelos.write",
  "departamentos.view",
  "departamentos.manage",
  "financeiro.view",
  "processos.financeiro",
  "comissoes.manage",
  "horas.gerir",
  "relatorios.view",
  "rh.funcionarios.ver",
  "usuarios.manage",
  "auditoria.view",
  "lixeira.gerir",
  "integracoes.manage",
  "lgpd.anonimizar",
] as const;

export type Permission = (typeof FUNCIONALIDADES)[number];

/** O sujeito é o perfil da sessão (com as permissões efetivas da empresa ativa). Sem permissões = nada. */
export function can(subject: { permissoes?: readonly string[] } | null | undefined, permission: Permission): boolean {
  return !!subject?.permissoes?.includes(permission);
}

export const isPermission = (v: string): v is Permission => (FUNCIONALIDADES as readonly string[]).includes(v);

// Perfis de escopo (app_role): definem QUAIS registros a pessoa enxerga, não o que ela pode fazer
export const isJuridicoRole = (role: string) => ["admin", "gestor", "advogado", "assistente_juridico"].includes(role);
export const isManagerRole = (role: string) => role === "admin" || role === "gestor";
export const isBackofficeRole = (role: string) => role === "admin" || role === "gestor" || role === "financeiro";
