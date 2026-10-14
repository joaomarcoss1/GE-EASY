export type AppRole = "admin" | "gestor" | "financeiro" | "consultor" | "consultor_externo";
export type LinhaNegocio = "consorcio" | "seguro";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: AppRole;
  active: boolean;
  avatar_url: string | null;
  cargo: string | null;
  territorio: string | null;
  comissao_percentual: number;
  created_at: string;
}

export interface Parceiro {
  id: string;
  tipo: "administradora" | "seguradora";
  nome: string;
  cnpj: string | null;
  contato: string | null;
  email: string | null;
  telefone: string | null;
  site: string | null;
  comissao_padrao: number;
  ativo: boolean;
}

export interface Produto {
  id: string;
  parceiro_id: string | null;
  linha: LinhaNegocio;
  categoria: string;
  nome: string;
  descricao: string | null;
  comissao_percentual: number;
  ativo: boolean;
}

export interface Cliente {
  id: string;
  tipo_pessoa: "PF" | "PJ";
  nome: string;
  documento: string | null;
  rg: string | null;
  data_nascimento: string | null;
  email: string | null;
  telefone: string | null;
  whatsapp: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  profissao: string | null;
  renda_mensal: number | null;
  origem: string | null;
  status: "lead" | "ativo" | "inativo";
  tags: string[];
  consultor_id: string | null;
  drive_folder_id: string | null;
  observacoes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Interacao {
  id: string;
  cliente_id: string;
  tipo: "nota" | "ligacao" | "email" | "whatsapp" | "visita" | "sistema";
  descricao: string;
  autor_id: string | null;
  created_at: string;
}

export type OportunidadeEtapa = "novo" | "contato" | "qualificacao" | "proposta" | "negociacao" | "ganho" | "perdido";
export interface Oportunidade {
  id: string;
  cliente_id: string;
  titulo: string;
  linha: LinhaNegocio;
  produto_id: string | null;
  valor: number;
  etapa: OportunidadeEtapa;
  probabilidade: number;
  previsao_fechamento: string | null;
  motivo_perda: string | null;
  consultor_id: string | null;
  fechado_em: string | null;
  observacoes: string | null;
  created_at: string;
}

export type CotaStatus = "proposta" | "ativa" | "contemplada" | "quitada" | "cancelada" | "inadimplente";
export type ContemplacaoForma = "sorteio" | "lance_livre" | "lance_fixo" | "lance_embutido";
export interface ConsorcioCota {
  id: string;
  cliente_id: string;
  administradora_id: string | null;
  produto_id: string | null;
  oportunidade_id: string | null;
  categoria: string;
  grupo: string | null;
  cota: string | null;
  numero_contrato: string | null;
  valor_credito: number;
  prazo_meses: number;
  parcela_valor: number;
  taxa_adm: number;
  fundo_reserva: number;
  data_adesao: string;
  dia_vencimento: number | null;
  parcelas_pagas: number;
  status: CotaStatus;
  contemplada_em: string | null;
  forma_contemplacao: ContemplacaoForma | null;
  valor_lance: number | null;
  cancelada_em: string | null;
  consultor_id: string | null;
  observacoes: string | null;
  created_at: string;
}

export interface ConsorcioLance {
  id: string;
  cota_id: string;
  data_assembleia: string;
  tipo: ContemplacaoForma;
  percentual: number | null;
  valor: number | null;
  resultado: "pendente" | "contemplado" | "nao_contemplado";
  observacoes: string | null;
  created_at: string;
}

export type ApoliceStatus = "cotacao" | "proposta" | "vigente" | "renovada" | "cancelada" | "vencida";
export interface SeguroApolice {
  id: string;
  cliente_id: string;
  seguradora_id: string | null;
  produto_id: string | null;
  oportunidade_id: string | null;
  renovacao_de: string | null;
  ramo: string;
  numero_apolice: string | null;
  numero_proposta: string | null;
  item_segurado: string | null;
  inicio_vigencia: string;
  fim_vigencia: string;
  premio_liquido: number;
  premio_total: number;
  forma_pagamento: string | null;
  parcelas: number;
  comissao_percentual: number;
  status: ApoliceStatus;
  consultor_id: string | null;
  observacoes: string | null;
  created_at: string;
}

export interface SeguroSinistro {
  id: string;
  apolice_id: string;
  numero_sinistro: string | null;
  data_ocorrencia: string;
  descricao: string;
  status: "aberto" | "em_analise" | "aprovado" | "negado" | "pago";
  valor_indenizacao: number | null;
  created_at: string;
}

export interface Comissao {
  id: string;
  linha: LinhaNegocio;
  cota_id: string | null;
  apolice_id: string | null;
  cliente_id: string | null;
  consultor_id: string | null;
  descricao: string | null;
  competencia: string;
  base_calculo: number;
  percentual_corretora: number;
  valor_corretora: number;
  percentual_consultor: number;
  valor_consultor: number;
  status: "prevista" | "recebida" | "paga" | "estornada";
  data_recebimento: string | null;
  data_pagamento: string | null;
  observacoes: string | null;
  created_at: string;
}

export type MetaTipo = "consorcio_credito" | "seguro_premio" | "novos_clientes" | "comissao";
export interface Meta {
  id: string;
  consultor_id: string | null;
  periodo: string;
  tipo: MetaTipo;
  valor_meta: number;
}

export type EventoTipo = "reuniao" | "visita" | "ligacao" | "assembleia" | "renovacao" | "tarefa" | "outro";
export interface AgendaEvento {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: EventoTipo;
  status: "agendado" | "concluido" | "cancelado";
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  local: string | null;
  link_reuniao: string | null;
  cliente_id: string | null;
  oportunidade_id: string | null;
  responsavel_id: string | null;
  participantes: string[];
  lembrete_minutos: number | null;
  google_event_id: string | null;
  created_by: string | null;
}

export interface Tarefa {
  id: string;
  titulo: string;
  descricao: string | null;
  status: "pendente" | "em_andamento" | "concluida";
  prioridade: "baixa" | "media" | "alta" | "urgente";
  vencimento: string | null;
  responsavel_id: string | null;
  cliente_id: string | null;
  concluida_em: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Visita {
  id: string;
  consultor_id: string;
  cliente_id: string | null;
  evento_id: string | null;
  checkin_em: string;
  checkin_lat: number | null;
  checkin_lng: number | null;
  checkin_precisao: number | null;
  checkout_em: string | null;
  resultado: string | null;
  observacoes: string | null;
}

export interface Documento {
  id: string;
  cliente_id: string | null;
  cota_id: string | null;
  apolice_id: string | null;
  nome: string;
  categoria: string;
  storage_path: string | null;
  mime_type: string | null;
  tamanho: number | null;
  drive_file_id: string | null;
  drive_url: string | null;
  enviado_por: string | null;
  created_at: string;
}

export interface Notificacao {
  id: string;
  user_id: string;
  titulo: string;
  mensagem: string | null;
  link: string | null;
  lida: boolean;
  created_at: string;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  acao: string;
  tabela: string;
  registro_id: string | null;
  dados_antigos: Record<string, unknown> | null;
  dados_novos: Record<string, unknown> | null;
  created_at: string;
}
