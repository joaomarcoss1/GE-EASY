import type { FieldDef, Values } from "@/components/ui/form";
import { PRAZO_CONTAGEM, PRIORIDADES, type Option } from "@/lib/constants";
import type { PrazoItem } from "./utils";

/**
 * Campos do formulário de prazo. Sem `processos`, o vínculo com o processo vem
 * de um campo oculto (aba do processo) e não é exibido.
 */
export function prazoFields(o: { processos?: Option[] | null; juridico: Option[]; departamentos: Option[] }): FieldDef[] {
  return [
    ...(o.processos
      ? [{ name: "processo_id", label: "Processo", type: "select", options: o.processos, emptyOption: "Sem processo (prazo administrativo)", span: 6, section: "Prazo" } as FieldDef]
      : []),
    {
      name: "descricao",
      label: "Descrição",
      required: true,
      placeholder: "Ex.: Contestação, réplica, recurso de apelação, manifestação sobre laudo…",
      span: 6,
      section: o.processos ? undefined : "Prazo",
    },
    { name: "data_publicacao", label: "Publicação / intimação", type: "date", span: 2, section: "Contagem (CPC)" },
    { name: "dias", label: "Dias", type: "number", min: 0, max: 365, step: "1", span: 1 },
    { name: "contagem", label: "Contagem", type: "select", options: PRAZO_CONTAGEM, emptyOption: false, span: 3 },
    {
      name: "feriados_extras",
      label: "Feriados locais / suspensões (opcional)",
      placeholder: "dd/mm/aaaa, dd/mm/aaaa",
      help: "Feriados estaduais/municipais ou dias sem expediente no tribunal, considerados no cálculo automático.",
      span: 6,
    },
    {
      name: "data_fim",
      label: "Vencimento",
      type: "date",
      span: 3,
      help: "Calculado automaticamente a partir da publicação + dias. Preencha se não houver publicação.",
    },
    { name: "manual", label: "Definir vencimento manualmente", type: "checkbox", help: "Usa a data informada mesmo com publicação + dias", span: 3 },
    { name: "fatal", label: "Prazo fatal", type: "checkbox", help: "Peremptório — a perda gera preclusão", span: 3, section: "Controle" },
    { name: "prioridade", label: "Prioridade", type: "select", options: PRIORIDADES, emptyOption: false, span: 3 },
    { name: "responsavel_id", label: "Responsável", type: "select", options: o.juridico, emptyOption: "Eu mesmo", span: 3 },
    { name: "departamento_id", label: "Departamento", type: "select", options: o.departamentos, emptyOption: "Herdar do processo", span: 3 },
    { name: "observacoes", label: "Observações", type: "textarea", rows: 3, placeholder: "Estratégia, documentos necessários, quem revisa…", span: 6 },
  ];
}

export const prazoDefaults = (extra?: Values): Values => ({ contagem: "uteis", fatal: true, prioridade: "alta", ...extra });

export function prazoValues(p: PrazoItem): Values {
  return {
    processo_id: p.processo_id,
    descricao: p.descricao,
    data_publicacao: p.data_publicacao,
    dias: p.dias,
    contagem: p.contagem,
    data_fim: p.data_fim,
    manual: false,
    fatal: p.fatal,
    prioridade: p.prioridade,
    responsavel_id: p.responsavel_id,
    departamento_id: p.departamento_id,
    observacoes: p.observacoes,
  };
}
