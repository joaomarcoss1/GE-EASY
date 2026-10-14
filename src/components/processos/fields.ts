import type { FieldDef } from "@/components/ui/form";
import {
  ANDAMENTO_TIPOS, INSTANCIAS, LANCAMENTO_STATUS, LANCAMENTO_TIPOS, PARTE_TIPOS, PROCESSO_AREAS, PROCESSO_FASES,
  PROCESSO_POLO, PROCESSO_RISCO, PROCESSO_STATUS, TRIBUNAIS, UFS, type Option,
} from "@/lib/constants";

export function processoFields(o: { clientes: Option[]; departamentos: Option[]; juridico: Option[] }): FieldDef[] {
  return [
    { name: "titulo", label: "Título / ação", required: true, placeholder: "Ex.: Ação revisional — João da Silva × Banco X", span: 6, section: "Identificação" },
    { name: "numero_cnj", label: "Número CNJ", type: "cnj", placeholder: "0000000-00.0000.0.00.0000", span: 4, help: "Validado pelo dígito verificador" },
    { name: "numero_interno", label: "Nº interno / pasta", span: 2 },
    { name: "cliente_id", label: "Cliente", type: "select", options: o.clientes, emptyOption: "Sem cliente vinculado", span: 4 },
    { name: "polo_cliente", label: "Posição do cliente", type: "select", options: PROCESSO_POLO, emptyOption: false, span: 2 },
    { name: "parte_contraria", label: "Parte contrária", span: 6 },
    { name: "area", label: "Área", type: "select", options: PROCESSO_AREAS, emptyOption: false, required: true, span: 2, section: "Juízo" },
    { name: "classe", label: "Classe processual", placeholder: "Ex.: Procedimento comum cível", span: 4 },
    { name: "assunto", label: "Assunto", span: 6 },
    { name: "tribunal", label: "Tribunal", type: "select", options: TRIBUNAIS, emptyOption: "—", span: 2 },
    { name: "orgao", label: "Vara / órgão julgador", span: 4 },
    { name: "comarca", label: "Comarca", span: 3 },
    { name: "uf", label: "UF", type: "select", options: UFS, span: 1 },
    { name: "instancia", label: "Instância", type: "select", options: INSTANCIAS, emptyOption: false, span: 2 },
    { name: "fase", label: "Fase", type: "select", options: PROCESSO_FASES, emptyOption: false, span: 2, section: "Situação e risco" },
    { name: "status", label: "Situação", type: "select", options: PROCESSO_STATUS, emptyOption: false, span: 2 },
    { name: "risco", label: "Risco (CPC 25)", type: "select", options: PROCESSO_RISCO, emptyOption: "Não avaliado", span: 2 },
    { name: "valor_causa", label: "Valor da causa", type: "money", span: 2 },
    { name: "valor_provisionado", label: "Valor provisionado", type: "money", span: 2 },
    { name: "data_distribuicao", label: "Distribuição", type: "date", span: 2 },
    { name: "departamento_id", label: "Departamento", type: "select", options: o.departamentos, emptyOption: "—", span: 3, section: "Responsáveis" },
    { name: "responsavel_id", label: "Advogado responsável", type: "select", options: o.juridico, emptyOption: "Eu mesmo", span: 3 },
    { name: "equipe", label: "Equipe com acesso", type: "multiselect", options: o.juridico, span: 6, help: "Além do departamento, essas pessoas também acessam o processo." },
    { name: "link_autos", label: "Link dos autos (PJe, e-SAJ…)", type: "url", placeholder: "https://", span: 4, section: "Outros" },
    { name: "segredo_justica", label: "Segredo de justiça", type: "checkbox", span: 2 },
    { name: "tags", label: "Etiquetas", placeholder: "Ex.: liminar, urgente, cliente VIP", help: "Separe por vírgula", span: 6 },
    { name: "resultado", label: "Resultado / desfecho", type: "textarea", rows: 2, span: 6 },
    { name: "observacoes", label: "Observações e estratégia", type: "textarea", rows: 4, span: 6 },
  ];
}

export const andamentoFields: FieldDef[] = [
  { name: "data", label: "Data", type: "date", required: true, span: 2 },
  { name: "tipo", label: "Tipo", type: "select", options: ANDAMENTO_TIPOS, emptyOption: false, span: 4 },
  { name: "descricao", label: "Descrição / teor", type: "textarea", rows: 8, required: true, span: 6, placeholder: "Cole aqui o teor da publicação, despacho ou decisão…" },
];

export const parteFields: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", options: PARTE_TIPOS, emptyOption: false, span: 3 },
  { name: "nome", label: "Nome", required: true, span: 3 },
  { name: "documento", label: "CPF / CNPJ", type: "documento", span: 3 },
  { name: "oab", label: "OAB (se advogado)", span: 3 },
  { name: "contato", label: "Contato", span: 6 },
  { name: "observacoes", label: "Observações", type: "textarea", rows: 2, span: 6 },
];

export const lancamentoFields: FieldDef[] = [
  { name: "tipo", label: "Tipo", type: "select", options: LANCAMENTO_TIPOS, emptyOption: false, span: 3 },
  { name: "valor", label: "Valor", type: "money", required: true, span: 3 },
  { name: "data", label: "Data", type: "date", required: true, span: 2 },
  { name: "vencimento", label: "Vencimento", type: "date", span: 2 },
  { name: "status", label: "Situação", type: "select", options: LANCAMENTO_STATUS, emptyOption: false, span: 2 },
  { name: "descricao", label: "Descrição", span: 6 },
];
