import type { AppRole } from "./types";

export type Tone = "brand" | "accent" | "green" | "amber" | "red" | "slate" | "sky" | "violet";

export interface Option {
  value: string;
  label: string;
  tone?: Tone;
}

export const toMap = (opts: Option[]) => Object.fromEntries(opts.map((o) => [o.value, o]));

export const ROLES: Option[] = [
  { value: "admin", label: "Administrador", tone: "brand" },
  { value: "gestor", label: "Gestor", tone: "violet" },
  { value: "financeiro", label: "Financeiro", tone: "green" },
  { value: "consultor", label: "Consultor interno", tone: "sky" },
  { value: "consultor_externo", label: "Consultor externo", tone: "accent" },
];
export const ROLE_LABEL: Record<AppRole, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<AppRole, string>;

export const CLIENTE_STATUS: Option[] = [
  { value: "lead", label: "Lead", tone: "amber" },
  { value: "ativo", label: "Ativo", tone: "green" },
  { value: "inativo", label: "Inativo", tone: "slate" },
];

export const ORIGENS: Option[] = [
  "Indicação", "Site", "Instagram", "Facebook", "WhatsApp", "Google", "Evento", "Parceiro", "Carteira antiga", "Prospecção ativa", "Outro",
].map((v) => ({ value: v, label: v }));

export const LINHAS: Option[] = [
  { value: "consorcio", label: "Consórcio", tone: "brand" },
  { value: "seguro", label: "Seguro", tone: "accent" },
];

export const ETAPAS: Option[] = [
  { value: "novo", label: "Novo", tone: "slate" },
  { value: "contato", label: "Contato", tone: "sky" },
  { value: "qualificacao", label: "Qualificação", tone: "violet" },
  { value: "proposta", label: "Proposta", tone: "brand" },
  { value: "negociacao", label: "Negociação", tone: "amber" },
  { value: "ganho", label: "Ganho", tone: "green" },
  { value: "perdido", label: "Perdido", tone: "red" },
];

export const CATEGORIAS_CONSORCIO: Option[] = [
  { value: "imovel", label: "Imóvel" },
  { value: "veiculo", label: "Veículo" },
  { value: "moto", label: "Moto" },
  { value: "pesados", label: "Pesados / Caminhões" },
  { value: "servicos", label: "Serviços" },
  { value: "agro", label: "Agro / Máquinas" },
];

export const COTA_STATUS: Option[] = [
  { value: "proposta", label: "Proposta", tone: "slate" },
  { value: "ativa", label: "Ativa", tone: "brand" },
  { value: "contemplada", label: "Contemplada", tone: "green" },
  { value: "quitada", label: "Quitada", tone: "violet" },
  { value: "inadimplente", label: "Inadimplente", tone: "amber" },
  { value: "cancelada", label: "Cancelada", tone: "red" },
];

export const CONTEMPLACAO: Option[] = [
  { value: "sorteio", label: "Sorteio" },
  { value: "lance_livre", label: "Lance livre" },
  { value: "lance_fixo", label: "Lance fixo" },
  { value: "lance_embutido", label: "Lance embutido" },
];

export const LANCE_RESULTADO: Option[] = [
  { value: "pendente", label: "Aguardando assembleia", tone: "amber" },
  { value: "contemplado", label: "Contemplado", tone: "green" },
  { value: "nao_contemplado", label: "Não contemplado", tone: "slate" },
];

export const RAMOS_SEGURO: Option[] = [
  { value: "auto", label: "Automóvel" },
  { value: "vida", label: "Vida" },
  { value: "residencial", label: "Residencial" },
  { value: "empresarial", label: "Empresarial" },
  { value: "saude", label: "Saúde" },
  { value: "odonto", label: "Odontológico" },
  { value: "viagem", label: "Viagem" },
  { value: "rc", label: "Responsabilidade civil" },
  { value: "frota", label: "Frota" },
  { value: "prestamista", label: "Prestamista" },
  { value: "outros", label: "Outros" },
];

export const APOLICE_STATUS: Option[] = [
  { value: "cotacao", label: "Cotação", tone: "slate" },
  { value: "proposta", label: "Proposta", tone: "sky" },
  { value: "vigente", label: "Vigente", tone: "green" },
  { value: "renovada", label: "Renovada", tone: "violet" },
  { value: "vencida", label: "Vencida", tone: "amber" },
  { value: "cancelada", label: "Cancelada", tone: "red" },
];

export const SINISTRO_STATUS: Option[] = [
  { value: "aberto", label: "Aberto", tone: "amber" },
  { value: "em_analise", label: "Em análise", tone: "sky" },
  { value: "aprovado", label: "Aprovado", tone: "brand" },
  { value: "negado", label: "Negado", tone: "red" },
  { value: "pago", label: "Pago", tone: "green" },
];

export const FORMAS_PAGAMENTO: Option[] = ["Boleto", "Cartão de crédito", "Débito em conta", "PIX", "À vista"].map((v) => ({ value: v, label: v }));

export const COMISSAO_STATUS: Option[] = [
  { value: "prevista", label: "Prevista", tone: "amber" },
  { value: "recebida", label: "Recebida", tone: "brand" },
  { value: "paga", label: "Paga ao consultor", tone: "green" },
  { value: "estornada", label: "Estornada", tone: "red" },
];

export const META_TIPOS: Option[] = [
  { value: "consorcio_credito", label: "Crédito vendido (consórcio)" },
  { value: "seguro_premio", label: "Prêmio emitido (seguros)" },
  { value: "novos_clientes", label: "Novos clientes" },
  { value: "comissao", label: "Comissão gerada" },
];

export const EVENTO_TIPOS: Option[] = [
  { value: "reuniao", label: "Reunião", tone: "brand" },
  { value: "visita", label: "Visita", tone: "accent" },
  { value: "ligacao", label: "Ligação", tone: "sky" },
  { value: "assembleia", label: "Assembleia", tone: "violet" },
  { value: "renovacao", label: "Renovação", tone: "amber" },
  { value: "tarefa", label: "Tarefa", tone: "slate" },
  { value: "outro", label: "Outro", tone: "slate" },
];

export const EVENTO_STATUS: Option[] = [
  { value: "agendado", label: "Agendado", tone: "brand" },
  { value: "concluido", label: "Concluído", tone: "green" },
  { value: "cancelado", label: "Cancelado", tone: "red" },
];

export const TAREFA_STATUS: Option[] = [
  { value: "pendente", label: "Pendente", tone: "amber" },
  { value: "em_andamento", label: "Em andamento", tone: "sky" },
  { value: "concluida", label: "Concluída", tone: "green" },
];

export const PRIORIDADES: Option[] = [
  { value: "baixa", label: "Baixa", tone: "slate" },
  { value: "media", label: "Média", tone: "sky" },
  { value: "alta", label: "Alta", tone: "amber" },
  { value: "urgente", label: "Urgente", tone: "red" },
];

export const DOC_CATEGORIAS: Option[] = [
  { value: "rg_cnh", label: "RG / CNH" },
  { value: "cpf_cnpj", label: "CPF / CNPJ" },
  { value: "comprovante_residencia", label: "Comprovante de residência" },
  { value: "comprovante_renda", label: "Comprovante de renda" },
  { value: "contrato", label: "Contrato" },
  { value: "proposta", label: "Proposta" },
  { value: "apolice", label: "Apólice" },
  { value: "boleto", label: "Boleto" },
  { value: "vistoria", label: "Vistoria" },
  { value: "outros", label: "Outros" },
];

export const INTERACAO_TIPOS: Option[] = [
  { value: "nota", label: "Nota" },
  { value: "ligacao", label: "Ligação" },
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "visita", label: "Visita" },
];

export const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO"
  .split(" ")
  .map((v) => ({ value: v, label: v }));
