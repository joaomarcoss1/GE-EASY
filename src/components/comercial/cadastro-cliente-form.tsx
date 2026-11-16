"use client";
import { useRouter } from "next/navigation";
import { ResourceForm, type FieldDef } from "@/components/ui/form";
import { cadastrarClienteComercial } from "@/lib/actions/comercial";
import { TIPOS_ACAO, UFS, type Option } from "@/lib/constants";
import { TERMO_LGPD_VERSAO } from "@/app/(app)/clientes/fields";

const ACEITOS = "application/pdf,image/jpeg,.pdf,.jpg,.jpeg";

export function cadastroClienteFields(assessores: Option[]): FieldDef[] {
  return [
    { name: "nome", label: "Nome completo", required: true, span: 6, section: "Dados do cliente" },
    { name: "documento", label: "CPF", type: "documento", required: true, span: 3 },
    { name: "email", label: "E-mail", type: "email", span: 3 },
    { name: "telefone", label: "Telefone", type: "tel", required: true, span: 3 },
    { name: "telefone_recado", label: "Telefone de recado", type: "tel", span: 3 },
    { name: "senha_gov", label: "Senha gov.br", type: "password", span: 3, help: "Guardada criptografada. Só aparece para quem pode editar o cliente, e cada consulta fica registrada." },
    { name: "tipo_acao", label: "Tipo de ação", type: "select", options: TIPOS_ACAO, required: true, span: 3 },
    { name: "cidade", label: "Cidade", required: true, span: 4 },
    { name: "uf", label: "UF", type: "select", options: UFS, required: true, span: 2 },
    { name: "assessor_id", label: "Assessor", type: "select", options: assessores, emptyOption: "Sem assessor", span: 6, help: assessores.length ? undefined : "Nenhum assessor cadastrado ainda (menu Comercial › Assessores)." },
    { name: "documentos", label: "Documentos do cliente (se houver)", type: "file", multiple: true, placeholder: ACEITOS, span: 6, section: "Anexos", help: "PDF ou JPEG, até 25 MB cada (máximo 10 arquivos)." },
    { name: "contrato", label: "Contrato assinado (se houver)", type: "file", multiple: true, placeholder: ACEITOS, span: 6, help: "PDF ou JPEG, até 25 MB." },
    {
      name: "lgpd_consentimento",
      label: "O titular autorizou o tratamento dos dados para atendimento e contratação (LGPD)",
      type: "checkbox",
      required: true,
      span: 6,
      section: "Consentimento",
      help: `Registramos data, hora, usuário e a versão do termo (${TERMO_LGPD_VERSAO}).`,
    },
  ];
}

/** Formulário de cadastro do comercial; ao salvar, abre a ficha do cliente. */
export function CadastroClienteForm({ assessores }: { assessores: Option[] }) {
  const router = useRouter();
  return (
    <ResourceForm
      action={cadastrarClienteComercial}
      fields={cadastroClienteFields(assessores)}
      submitLabel="Cadastrar cliente"
      onSuccess={(s) => s.id && router.push(`/clientes/${s.id}`)}
    />
  );
}
