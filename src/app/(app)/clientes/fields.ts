import type { FieldDef } from "@/components/ui/form";
import { CLIENTE_STATUS, ORIGENS, UFS, type Option } from "@/lib/constants";

export const TERMO_LGPD_VERSAO = "2026-10";

/** Situações possíveis no cadastro novo (o restante do ciclo é conduzido pela análise documental). */
const SITUACAO_INICIAL: Option[] = [
  { value: "pre_cadastro", label: "Pré-cadastro (dados mínimos)" },
  { value: "pendente_documentacao", label: "Coletar documentação (abre o prazo)" },
];

export function clienteFields(consultores: Option[], canTransfer: boolean, novo = false): FieldDef[] {
  return [
    { name: "tipo_pessoa", label: "Tipo", type: "select", options: [{ value: "PF", label: "Pessoa física" }, { value: "PJ", label: "Pessoa jurídica" }], emptyOption: false, span: 2, section: "Identificação" },
    { name: "nome", label: "Nome / Razão social", required: true, span: 4 },
    { name: "documento", label: "CPF / CNPJ", type: "documento", span: 2 },
    { name: "rg", label: "RG / IE", span: 2 },
    { name: "data_nascimento", label: "Nascimento / Fundação", type: "date", span: 2 },
    { name: "email", label: "E-mail", type: "email", span: 3, section: "Contato" },
    { name: "telefone", label: "Telefone", type: "tel", span: 3 },
    { name: "whatsapp", label: "WhatsApp", type: "tel", span: 3 },
    { name: "origem", label: "Origem do contato", type: "select", options: ORIGENS, span: 3 },
    { name: "cep", label: "CEP", type: "cep", span: 2, section: "Endereço" },
    { name: "endereco", label: "Logradouro", span: 4 },
    { name: "numero", label: "Número", span: 1 },
    { name: "complemento", label: "Complemento", span: 2 },
    { name: "bairro", label: "Bairro", span: 3 },
    { name: "cidade", label: "Cidade", span: 4 },
    { name: "uf", label: "UF", type: "select", options: UFS, span: 2 },
    { name: "profissao", label: "Profissão / Ramo", span: 3, section: "Perfil comercial" },
    { name: "renda_mensal", label: "Renda / Faturamento mensal", type: "money", span: 3 },
    { name: "status", label: "Status comercial", type: "select", options: CLIENTE_STATUS, emptyOption: false, span: 2 },
    ...(novo ? [{ name: "status_cadastro", label: "Situação do cadastro", type: "select", options: SITUACAO_INICIAL, emptyOption: false, span: 4 } as FieldDef] : []),
    ...(canTransfer ? [{ name: "consultor_id", label: "Consultor responsável", type: "select", options: consultores, emptyOption: "Eu mesmo", span: 4 } as FieldDef] : []),
    { name: "tags", label: "Etiquetas", placeholder: "Ex.: VIP, indicação João, frota", help: "Separe por vírgula", span: 6 },
    { name: "observacoes", label: "Observações", type: "textarea", rows: 4, span: 6 },
    ...(novo
      ? [{
          name: "lgpd_consentimento",
          label: "O titular autorizou o tratamento dos dados para atendimento e contratação (LGPD)",
          type: "checkbox",
          required: true,
          help: `Registramos data, hora, usuário e a versão do termo (${TERMO_LGPD_VERSAO}).`,
          span: 6,
          section: "Consentimento",
        } as FieldDef]
      : []),
  ];
}
