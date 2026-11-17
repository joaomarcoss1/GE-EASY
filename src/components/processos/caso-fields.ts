import type { FieldDef } from "@/components/ui/form";

/** Campos editáveis do processo (protocolo e estado atual são obrigatórios quando habilitado). */
export const CASO_FIELDS: FieldDef[] = [
  { name: "protocolo_inss", label: "Protocolo do INSS", span: 6, placeholder: "Número do protocolo", help: "Obrigatório para processos habilitados." },
  { name: "situacao_atual", label: "Estado atual do processo", type: "textarea", rows: 2, span: 6, placeholder: "Ex.: aguardando perícia em 12/12; em análise no INSS" },
  { name: "observacoes", label: "Observações", type: "textarea", rows: 4, span: 6 },
];
