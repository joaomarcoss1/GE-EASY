import type { FieldDef } from "@/components/ui/form";
import { APOLICE_STATUS, FORMAS_PAGAMENTO, RAMOS_SEGURO, SINISTRO_STATUS, type Option } from "@/lib/constants";

interface ApoliceFieldOptions {
  clientes: Option[];
  seguradoras: Option[];
  produtos: Option[];
  consultores: Option[];
  canTransfer: boolean;
  edit?: boolean;
}

export function apoliceFields({ clientes, seguradoras, produtos, consultores, canTransfer, edit }: ApoliceFieldOptions): FieldDef[] {
  return [
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, required: true, span: 6, section: "Cliente e seguro", emptyOption: "Selecione o cliente…" },
    { name: "seguradora_id", label: "Seguradora", type: "select", options: seguradoras, span: 3 },
    { name: "produto_id", label: "Produto", type: "select", options: produtos, span: 3 },
    { name: "ramo", label: "Ramo", type: "select", options: RAMOS_SEGURO, emptyOption: false, required: true, span: 2 },
    { name: "numero_apolice", label: "Nº da apólice", span: 2 },
    { name: "numero_proposta", label: "Nº da proposta", span: 2 },
    { name: "item_segurado", label: "Item segurado", placeholder: "Ex.: Toyota Corolla 2023 · placa ABC1D23", span: 4 },
    { name: "status", label: "Status", type: "select", options: APOLICE_STATUS, emptyOption: false, required: true, span: 2, help: "Comissão gerada ao ficar vigente" },
    { name: "inicio_vigencia", label: "Início da vigência", type: "date", required: true, span: 3, section: "Vigência e valores" },
    { name: "fim_vigencia", label: "Fim da vigência", type: "date", required: true, span: 3 },
    { name: "premio_liquido", label: "Prêmio líquido", type: "money", span: 3 },
    { name: "premio_total", label: "Prêmio total", type: "money", span: 3, help: "Com IOF e encargos" },
    { name: "forma_pagamento", label: "Forma de pagamento", type: "select", options: FORMAS_PAGAMENTO, span: 2 },
    { name: "parcelas", label: "Parcelas", type: "number", min: 1, max: 24, step: "1", span: 2 },
    { name: "comissao_percentual", label: "Comissão", type: "percent", span: 2, help: "Sobre o prêmio líquido" },
    ...(canTransfer
      ? ([{ name: "consultor_id", label: "Consultor responsável", type: "select", options: consultores, emptyOption: edit ? "Manter o atual" : "Consultor do cliente", span: 6, section: "Responsável" }] satisfies FieldDef[])
      : []),
    { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6, section: canTransfer ? undefined : "Observações" },
  ];
}

export const sinistroFields: FieldDef[] = [
  { name: "numero_sinistro", label: "Nº do sinistro", span: 3 },
  { name: "data_ocorrencia", label: "Data da ocorrência", type: "date", required: true, span: 3 },
  { name: "status", label: "Status", type: "select", options: SINISTRO_STATUS, emptyOption: false, required: true, span: 3 },
  { name: "valor_indenizacao", label: "Valor da indenização", type: "money", span: 3 },
  { name: "descricao", label: "Descrição", type: "textarea", rows: 5, required: true, span: 6, placeholder: "O que aconteceu, local, envolvidos, providências…" },
];

/** YYYY-MM-DD + 1 ano (29/02 vira 28/02) */
export function addYearISO(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y + 1, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/** YYYY-MM-DD + n dias */
export function addDaysISO(iso: string, days: number) {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Tom do aviso de vencimento conforme a urgência */
export function vencimentoTone(dias: number): "red" | "amber" | "sky" | "slate" {
  if (dias <= 15) return "red";
  if (dias <= 30) return "amber";
  if (dias <= 60) return "sky";
  return "slate";
}

export function vencimentoLabel(dias: number) {
  if (dias < 0) return `Venceu há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}`;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias`;
}
