import type { FieldDef } from "@/components/ui/form";
import { DEPARTAMENTO_CORES, PRIORIDADES, TAREFA_STATUS, type Option } from "@/lib/constants";

/** Formulário de demanda (tarefa vinculada ao departamento). */
export function demandaFields(o: { processos: Option[]; membros: Option[]; canAssign: boolean; withStatus: boolean }): FieldDef[] {
  return [
    { name: "titulo", label: "Demanda", required: true, placeholder: "Ex.: Elaborar contestação", span: 6 },
    { name: "prioridade", label: "Prioridade", type: "select", options: PRIORIDADES, emptyOption: false, span: o.withStatus ? 2 : 3 },
    { name: "vencimento", label: "Prazo interno", type: "date", span: o.withStatus ? 2 : 3 },
    ...(o.withStatus ? [{ name: "status", label: "Status", type: "select", options: TAREFA_STATUS, emptyOption: false, span: 2 } as FieldDef] : []),
    { name: "processo_id", label: "Processo vinculado", type: "select", options: o.processos, emptyOption: "Sem processo", span: o.canAssign ? 3 : 6 },
    ...(o.canAssign
      ? [{ name: "responsavel_id", label: "Responsável", type: "select", options: o.membros, emptyOption: "Eu mesmo", span: 3, help: "Membros do departamento" } as FieldDef]
      : []),
    { name: "descricao", label: "Descrição", type: "textarea", rows: 4, placeholder: "Contexto, entregáveis, links…", span: 6 },
  ];
}

export const FUNCOES_DEP: Option[] = [
  { value: "responsavel", label: "Responsável", tone: "accent" },
  { value: "membro", label: "Membro", tone: "slate" },
];

export function departamentoFields(users: Option[]): FieldDef[] {
  return [
    { name: "nome", label: "Nome do departamento", required: true, placeholder: "Ex.: Jurídico Contencioso", span: 4 },
    { name: "sigla", label: "Sigla", placeholder: "Ex.: CONT", span: 2, help: "Até 12 caracteres" },
    { name: "cor", label: "Cor", type: "select", options: DEPARTAMENTO_CORES, emptyOption: false, span: 2 },
    { name: "responsavel_id", label: "Responsável", type: "select", options: users, emptyOption: "Sem responsável", span: 4, help: "Coordena a equipe e distribui as demandas." },
    { name: "descricao", label: "Descrição / atribuições", type: "textarea", rows: 3, span: 6 },
  ];
}

export function membroFields(users: Option[]): FieldDef[] {
  return [
    { name: "user_id", label: "Pessoa", type: "select", options: users, required: true, span: 4 },
    { name: "funcao", label: "Função", type: "select", options: FUNCOES_DEP, emptyOption: false, span: 2 },
  ];
}
