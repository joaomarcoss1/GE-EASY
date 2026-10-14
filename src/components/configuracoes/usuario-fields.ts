import type { FieldDef } from "@/components/ui/form";
import { ROLES } from "@/lib/constants";

export const inviteFields: FieldDef[] = [
  { name: "email", label: "E-mail", type: "email", required: true, span: 6, section: "Acesso" },
  { name: "full_name", label: "Nome completo", required: true, span: 6 },
  { name: "role", label: "Papel", type: "select", options: ROLES, emptyOption: false, required: true, span: 3 },
  { name: "comissao_percentual", label: "Comissão do consultor", type: "percent", span: 3, help: "% sobre a comissão da corretora" },
  { name: "territorio", label: "Território", placeholder: "Ex.: Zona Sul / Campinas", span: 6 },
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
