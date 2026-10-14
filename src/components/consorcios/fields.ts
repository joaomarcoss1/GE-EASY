import type { FieldDef } from "@/components/ui/form";
import { CATEGORIAS_CONSORCIO, CONTEMPLACAO, COTA_STATUS, LANCE_RESULTADO, type Option } from "@/lib/constants";

export interface CotaFieldOptions {
  clientes: Option[];
  administradoras: Option[];
  produtos: Option[];
  consultores: Option[];
  canTransfer: boolean;
  /** Formulário de edição: inclui os dados de contemplação */
  edit?: boolean;
}

export function cotaFields({ clientes, administradoras, produtos, consultores, canTransfer, edit }: CotaFieldOptions): FieldDef[] {
  return [
    { name: "cliente_id", label: "Cliente", type: "select", options: clientes, required: true, span: 6, section: "Cliente e plano", emptyOption: "Selecione o cliente…" },
    { name: "administradora_id", label: "Administradora", type: "select", options: administradoras, span: 3 },
    { name: "produto_id", label: "Produto / plano", type: "select", options: produtos, span: 3 },
    { name: "categoria", label: "Categoria", type: "select", options: CATEGORIAS_CONSORCIO, emptyOption: false, required: true, span: 2 },
    { name: "grupo", label: "Grupo", placeholder: "Ex.: 1234", span: 2 },
    { name: "cota", label: "Cota", placeholder: "Ex.: 056", span: 2 },
    { name: "numero_contrato", label: "Nº do contrato", span: 3 },
    { name: "status", label: "Status", type: "select", options: COTA_STATUS, emptyOption: false, required: true, span: 3 },
    { name: "valor_credito", label: "Valor do crédito", type: "money", required: true, span: 3, section: "Valores e prazo" },
    { name: "prazo_meses", label: "Prazo (meses)", type: "number", required: true, min: 1, max: 400, step: "1", span: 3 },
    { name: "parcela_valor", label: "Valor da parcela", type: "money", span: 2 },
    { name: "taxa_adm", label: "Taxa de administração", type: "percent", help: "Total do plano", span: 2 },
    { name: "fundo_reserva", label: "Fundo de reserva", type: "percent", span: 2 },
    { name: "data_adesao", label: "Data de adesão", type: "date", required: true, span: 2 },
    { name: "dia_vencimento", label: "Dia de vencimento", type: "number", min: 1, max: 31, step: "1", span: 2 },
    { name: "parcelas_pagas", label: "Parcelas pagas", type: "number", min: 0, max: 400, step: "1", span: 2 },
    ...(edit
      ? ([
          { name: "contemplada_em", label: "Contemplada em", type: "date", span: 2, section: "Contemplação", help: "Preenchido automaticamente ao registrar um lance contemplado" },
          { name: "forma_contemplacao", label: "Forma", type: "select", options: CONTEMPLACAO, span: 2 },
          { name: "valor_lance", label: "Valor do lance", type: "money", span: 2 },
        ] satisfies FieldDef[])
      : []),
    ...(canTransfer
      ? ([{ name: "consultor_id", label: "Consultor responsável", type: "select", options: consultores, emptyOption: edit ? "Manter o atual" : "Consultor do cliente", span: 6, section: "Responsável" }] satisfies FieldDef[])
      : []),
    { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6, section: canTransfer ? undefined : "Observações" },
  ];
}

export const lanceFields: FieldDef[] = [
  { name: "data_assembleia", label: "Data da assembleia", type: "date", required: true, span: 3 },
  { name: "tipo", label: "Tipo", type: "select", options: CONTEMPLACAO, emptyOption: false, required: true, span: 3 },
  { name: "percentual", label: "Percentual do lance", type: "percent", span: 3, help: "Sobre o crédito" },
  { name: "valor", label: "Valor do lance", type: "money", span: 3 },
  { name: "resultado", label: "Resultado", type: "select", options: LANCE_RESULTADO, emptyOption: false, required: true, span: 6, help: "Ao marcar como contemplado, a cota é atualizada automaticamente." },
  { name: "observacoes", label: "Observações", type: "textarea", rows: 3, span: 6 },
];
