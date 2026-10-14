import type { FieldDef } from "@/components/ui/form";
import { PRIORIDADES, TAREFA_STATUS, type Option } from "@/lib/constants";

export function tarefaFields(clientes: Option[], users: Option[], manager: boolean, withStatus: boolean): FieldDef[] {
  return [
    { name: "titulo", label: "Título", required: true, placeholder: "Ex.: Enviar simulação de consórcio", span: 6 },
    { name: "prioridade", label: "Prioridade", type: "select", options: PRIORIDADES, emptyOption: false, span: withStatus ? 2 : 3 },
    { name: "vencimento", label: "Vencimento", type: "date", span: withStatus ? 2 : 3 },
    ...(withStatus ? [{ name: "status", label: "Status", type: "select", options: TAREFA_STATUS, emptyOption: false, span: 2 } as FieldDef] : []),
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, emptyOption: "Sem cliente vinculado", span: manager ? 3 : 6 },
    ...(manager ? [{ name: "responsavel_id", label: "Responsável", type: "select", options: users, emptyOption: "Eu mesmo", span: 3 } as FieldDef] : []),
    { name: "descricao", label: "Descrição", type: "textarea", rows: 4, placeholder: "Detalhes, próximos passos…", span: 6 },
  ];
}
