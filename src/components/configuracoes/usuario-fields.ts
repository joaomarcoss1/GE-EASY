import type { FieldDef } from "@/components/ui/form";
import { ROLES, type Option } from "@/lib/constants";

const SENHA_HELP = "Mínimo de 10 caracteres, com maiúscula, minúscula e número";

/** Criação do acesso direto no sistema. Níveis de departamento só aparecem para o administrador master. */
export function novoUsuarioFields(niveis: Option[] = []): FieldDef[] {
  return [
    { name: "full_name", label: "Nome completo", required: true, span: 6, section: "Pessoa" },
    { name: "email", label: "E-mail (login)", type: "email", required: true, span: 6 },
    { name: "senha", label: "Senha inicial", type: "password", span: 3, section: "Senha", help: SENHA_HELP },
    { name: "confirmar", label: "Confirmar senha", type: "password", span: 3, help: "Se o e-mail já tiver conta em outra empresa, a senha atual dele é mantida" },
    { name: "trocar_senha", label: "Pedir para trocar a senha no primeiro acesso", type: "checkbox", span: 6 },
    { name: "role", label: "Perfil (o que a pessoa enxerga)", type: "select", options: ROLES, emptyOption: false, required: true, span: 3, section: "Acesso" },
    ...(niveis.length ? [{ name: "nivel_id", label: "Departamento e nível", type: "select", options: niveis, emptyOption: "Padrão do perfil", span: 3 } as FieldDef] : []),
    { name: "comissao_percentual", label: "Comissão do consultor", type: "percent", span: 3, help: "% sobre a comissão da corretora" },
    { name: "territorio", label: "Território", placeholder: "Ex.: Zona Sul / Campinas", span: 3 },
  ];
}

export const senhaUsuarioFields: FieldDef[] = [
  { name: "senha", label: "Nova senha", type: "password", required: true, span: 3, help: SENHA_HELP },
  { name: "confirmar", label: "Confirmar senha", type: "password", required: true, span: 3 },
  { name: "trocar_senha", label: "Pedir para trocar a senha no próximo acesso", type: "checkbox", span: 6 },
];

export const editUsuarioFields: FieldDef[] = [
  { name: "role", label: "Papel", type: "select", options: ROLES, emptyOption: false, required: true, span: 3 },
  { name: "comissao_percentual", label: "Comissão do consultor", type: "percent", span: 3 },
  { name: "territorio", label: "Território", span: 3 },
  { name: "cargo", label: "Cargo", span: 3 },
  { name: "active", label: "Acesso ativo", type: "checkbox", help: "Usuários inativos não conseguem acessar o sistema.", span: 6 },
];

export function consultorEditFields(isAdmin: boolean): FieldDef[] {
  return [
    { name: "territorio", label: "Território", placeholder: "Ex.: Zona Sul / Campinas", span: 3 },
    { name: "cargo", label: "Cargo", span: 3 },
    ...(isAdmin ? [{ name: "comissao_percentual", label: "Comissão do consultor", type: "percent", help: "Somente administradores alteram a comissão.", span: 3 } as FieldDef] : []),
  ];
}
