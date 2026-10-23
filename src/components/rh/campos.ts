import { TIPOS_CONTRATO } from "@/lib/constants";
import type { FieldDef } from "@/components/ui/form";

/** Campos do cadastro contratual do funcionário (admissão e edição). */
export const camposFuncionario = (deps: { value: string; label: string }[], jornadas: { value: string; label: string }[]): FieldDef[] => [
  { name: "nome", label: "Nome completo", required: true, span: 6 },
  { name: "matricula", label: "Matrícula", span: 2 },
  { name: "cargo", label: "Cargo", span: 4 },
  { name: "departamento_id", label: "Departamento", type: "select", options: deps, span: 3 },
  { name: "jornada_id", label: "Jornada", type: "select", options: jornadas, span: 3 },
  { name: "tipo_contrato", label: "Contrato", type: "select", options: TIPOS_CONTRATO, required: true, span: 3 },
  { name: "admissao", label: "Admissão", type: "date", span: 3 },
  { name: "email", label: "E-mail", type: "email", span: 3 },
  { name: "telefone", label: "Telefone", type: "tel", span: 3 },
  { name: "controla_ponto", label: "Controla ponto", type: "checkbox", span: 3 },
  { name: "ponto_externo", label: "Trabalho externo (ponto em qualquer lugar)", type: "checkbox", span: 3 },
  { name: "observacoes", label: "Observações", type: "textarea", rows: 2, span: 6 },
];
