import type { FieldDef } from "@/components/ui/form";
import { PRIORIDADES, TAREFA_STATUS, type Option } from "@/lib/constants";

/**
 * Campos do formulário de tarefa/demanda.
 * `extra.departamentos` / `extra.processos` adicionam os vínculos opcionais;
 * `extra.canAssign` mostra o responsável para quem não é gestor (responsável de departamento).
 */
export function tarefaFields(
  clientes: Option[],
  users: Option[],
  manager: boolean,
  withStatus: boolean,
  extra: { departamentos?: Option[]; processos?: Option[]; canAssign?: boolean } = {},
): FieldDef[] {
  const showResp = manager || !!extra.canAssign;
  const hasDep = !!extra.departamentos;
  const hasProc = !!extra.processos;
  return [
    { name: "titulo", label: "Título", required: true, placeholder: "Ex.: Protocolar petição / enviar documentos ao cliente", span: 6 },
    { name: "prioridade", label: "Prioridade", type: "select", options: PRIORIDADES, emptyOption: false, span: withStatus ? 2 : 3 },
    { name: "vencimento", label: "Vencimento", type: "date", span: withStatus ? 2 : 3 },
    ...(withStatus ? [{ name: "status", label: "Status", type: "select", options: TAREFA_STATUS, emptyOption: false, span: 2 } as FieldDef] : []),
    ...(hasDep
      ? [{ name: "departamento_id", label: "Departamento", type: "select", options: extra.departamentos, emptyOption: "Sem departamento", span: hasProc ? 3 : 6 } as FieldDef]
      : []),
    ...(hasProc ? [{ name: "processo_id", label: "Processo", type: "select", options: extra.processos, emptyOption: "Sem processo vinculado", span: hasDep ? 3 : 6 } as FieldDef] : []),
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, emptyOption: "Sem cliente vinculado", span: showResp ? 3 : 6 },
    ...(showResp
      ? [
          {
            name: "responsavel_id",
            label: "Responsável",
            type: "select",
            options: users,
            emptyOption: "Eu mesmo",
            span: 3,
            help: manager ? undefined : "Atribuir a outra pessoa só vale para demandas do departamento que você coordena.",
          } as FieldDef,
        ]
      : []),
    { name: "descricao", label: "Descrição", type: "textarea", rows: 4, placeholder: "Detalhes, próximos passos…", span: 6 },
  ];
}
