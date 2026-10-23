import type { FieldDef } from "@/components/ui/form";
import {
  CONTRATO_STATUS, CONTRATO_TIPOS, FIN_CATEGORIAS_DESPESA, FIN_CATEGORIAS_RECEITA, FIN_STATUS, FORMAS_PAGAMENTO_ESC, type Option,
} from "@/lib/constants";

export function lancamentoFields(tipo: "receita" | "despesa", o: { clientes: Option[]; processos: Option[]; departamentos: Option[]; centros?: Option[]; contas?: Option[] }, novo = true): FieldDef[] {
  return [
    { name: "tipo", type: "hidden" },
    { name: "categoria", label: "Categoria", type: "select", options: tipo === "receita" ? FIN_CATEGORIAS_RECEITA : FIN_CATEGORIAS_DESPESA, emptyOption: false, span: 3 },
    { name: "valor", label: "Valor", type: "money", required: true, span: 3 },
    { name: "descricao", label: "Descrição", required: true, span: 6 },
    { name: "vencimento", label: "Vencimento", type: "date", required: true, span: 2 },
    { name: "status", label: "Situação", type: "select", options: FIN_STATUS, emptyOption: false, span: 2 },
    { name: "forma_pagamento", label: "Forma", type: "select", options: FORMAS_PAGAMENTO_ESC, emptyOption: "—", span: 2 },
    { name: "cliente_id", label: "Cliente", type: "select", options: o.clientes, emptyOption: "—", span: 3, section: "Vínculos" },
    { name: "processo_id", label: "Processo", type: "select", options: o.processos, emptyOption: "—", span: 3 },
    { name: "departamento_id", label: "Departamento", type: "select", options: o.departamentos, emptyOption: "—", span: 3 },
    ...(o.centros?.length ? ([{ name: "centro_custo_id", label: "Centro de custo", type: "select", options: o.centros, emptyOption: "—", span: 3 }] as FieldDef[]) : []),
    ...(o.contas?.length ? ([{ name: "conta_id", label: "Conta bancária", type: "select", options: o.contas, emptyOption: "—", span: 3 }] as FieldDef[]) : []),
    ...(tipo === "despesa"
      ? ([
          { name: "fornecedor", label: "Fornecedor", span: 3 },
          { name: "reembolsavel", label: "Despesa reembolsável pelo cliente", type: "checkbox", span: 6 },
        ] as FieldDef[])
      : ([{ name: "documento_ref", label: "Nota / recibo", span: 3 }] as FieldDef[])),
    ...(novo ? ([{ name: "repetir", label: "Repetir mensalmente", type: "number", min: 1, max: 60, span: 2, help: "Nº de meses" }] as FieldDef[]) : []),
    { name: "observacoes", label: "Observações", type: "textarea", rows: 2, span: 6 },
  ];
}

export function contratoFields(o: { clientes: Option[]; processos: Option[]; departamentos: Option[]; juridico: Option[] }): FieldDef[] {
  return [
    { name: "titulo", label: "Objeto do contrato", required: true, placeholder: "Ex.: Ação revisional — consórcio", span: 4, section: "Contrato" },
    { name: "numero", label: "Nº do contrato", span: 2 },
    { name: "cliente_id", label: "Cliente", type: "select", options: o.clientes, required: true, span: 3 },
    { name: "processo_id", label: "Processo (opcional)", type: "select", options: o.processos, emptyOption: "—", span: 3 },
    { name: "tipo", label: "Modalidade de honorários", type: "select", options: CONTRATO_TIPOS, emptyOption: false, span: 3, section: "Honorários" },
    { name: "status", label: "Situação", type: "select", options: CONTRATO_STATUS, emptyOption: false, span: 3 },
    { name: "valor_fixo", label: "Valor fixo total", type: "money", span: 2, help: "Fixo / misto" },
    { name: "parcelas", label: "Parcelas", type: "number", min: 1, max: 120, span: 1 },
    { name: "valor_mensal", label: "Valor mensal", type: "money", span: 2, help: "Mensal / partido" },
    { name: "dia_vencimento", label: "Dia venc.", type: "number", min: 1, max: 31, span: 1 },
    { name: "percentual_exito", label: "% de êxito", type: "percent", span: 2, help: "Sobre o proveito econômico" },
    { name: "valor_hora", label: "Valor da hora", type: "money", span: 2 },
    { name: "indice_reajuste", label: "Índice de reajuste", placeholder: "Ex.: IPCA anual", span: 2 },
    { name: "data_inicio", label: "Início", type: "date", required: true, span: 3, section: "Vigência e gestão" },
    { name: "data_fim", label: "Término", type: "date", span: 3 },
    { name: "responsavel_id", label: "Advogado responsável", type: "select", options: o.juridico, emptyOption: "Eu mesmo", span: 3 },
    { name: "departamento_id", label: "Departamento", type: "select", options: o.departamentos, emptyOption: "—", span: 3 },
    { name: "observacoes", label: "Cláusulas e observações", type: "textarea", rows: 3, span: 6 },
  ];
}

export function descricaoHonorarios(c: { tipo: string; valor_fixo: number | null; parcelas: number; valor_mensal: number | null; percentual_exito: number | null; valor_hora: number | null }) {
  const brl = (v: number | null) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fixo = `${brl(c.valor_fixo)}${c.parcelas > 1 ? ` em ${c.parcelas} parcelas mensais` : " à vista"}`;
  switch (c.tipo) {
    case "fixo":
      return `honorários fixos de ${fixo}`;
    case "mensal":
      return `honorários mensais de ${brl(c.valor_mensal)}`;
    case "exito":
      return `honorários de êxito de ${Number(c.percentual_exito ?? 0)}% sobre o proveito econômico obtido`;
    case "hora":
      return `honorários de ${brl(c.valor_hora)} por hora trabalhada`;
    case "por_ato":
      return "honorários por ato processual, conforme tabela anexa";
    case "misto":
      return `honorários fixos de ${fixo}, acrescidos de ${Number(c.percentual_exito ?? 0)}% sobre o proveito econômico obtido`;
    default:
      return "";
  }
}
