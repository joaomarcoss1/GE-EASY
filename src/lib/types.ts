export type AppRole = "admin" | "gestor" | "financeiro" | "advogado" | "assistente_juridico" | "administrativo" | "consultor" | "consultor_externo";
export type LinhaNegocio = "consorcio" | "seguro";
/** Áreas de trabalho (entrada por departamento) */
export type Area = "consultor" | "administrativo" | "juridico" | "rh" | "financeiro";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  /** Na sessão: papel do vínculo com a empresa ativa (escopo dos dados) */
  role: AppRole;
  /** Na sessão: conta ativa E vínculo ativo na empresa */
  active: boolean;
  avatar_url: string | null;
  cargo: string | null;
  territorio: string | null;
  comissao_percentual: number;
  is_master: boolean;
  oab: string | null;
  created_at: string;
  /** Somente na sessão: funcionalidades efetivas na empresa ativa */
  permissoes?: string[];
  admin_master?: boolean;
}

export interface EmpresaResumo {
  id: string;
  nome: string;
  slug: string;
  status: "trial" | "ativa" | "suspensa" | "cancelada";
  marca?: { cor?: string; logo_url?: string } | null;
  fuso?: string;
  modulos?: string[];
}

export type CadastroStatus = "pre_cadastro" | "pendente_documentacao" | "documentacao_completa" | "transferido_administrativo" | "ativo" | "perdido" | "inativo";
export type Carteira = "consultor" | "administrativo" | "juridico";

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
  carteira: Carteira;
  status_cadastro: CadastroStatus;
  pendente_desde: string | null;
  prazo_documentacao: string | null;
  prorrogacoes: number;
  transferido_em: string | null;
  consultor_original_id: string | null;
  responsavel_admin_id: string | null;
  motivo_perda: string | null;
  lgpd_consentimento_em: string | null;
  lgpd_termo_versao: string | null;
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

export type EventoTipo = "reuniao" | "visita" | "ligacao" | "assembleia" | "renovacao" | "tarefa" | "audiencia" | "prazo" | "outro";
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
  processo_id?: string | null;
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
  processo_id: string | null;
  departamento_id: string | null;
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
  drive_status?: "pendente" | "sincronizado" | "erro" | "ignorado";
  drive_erro?: string | null;
  processo_id?: string | null;
  enviado_por: string | null;
  created_at: string;
  analise_status?: "enviado" | "em_analise" | "aprovado" | "recusado" | "vencido";
  analise_motivo?: string | null;
  analisado_por?: string | null;
  analisado_em?: string | null;
  validade?: string | null;
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


// ---------------------------------------------------------------- Jurídico

export interface Departamento {
  id: string;
  nome: string;
  sigla: string | null;
  descricao: string | null;
  cor: string;
  responsavel_id: string | null;
  ativo: boolean;
  tipo: string;
}

export interface DepartamentoMembro {
  departamento_id: string;
  user_id: string;
  funcao: "responsavel" | "membro";
}

export type ProcessoStatus = "ativo" | "suspenso" | "arquivado" | "encerrado";
export type ProcessoFase = "pre_processual" | "conhecimento" | "recursal" | "execucao" | "cumprimento_sentenca" | "acordo" | "transito_julgado";

export interface Processo {
  id: string;
  numero_cnj: string | null;
  numero_interno: string | null;
  titulo: string;
  cliente_id: string | null;
  polo_cliente: "ativo" | "passivo" | "terceiro";
  parte_contraria: string | null;
  area: string;
  classe: string | null;
  assunto: string | null;
  tribunal: string | null;
  orgao: string | null;
  comarca: string | null;
  uf: string | null;
  instancia: number;
  fase: ProcessoFase;
  status: ProcessoStatus;
  risco: "provavel" | "possivel" | "remoto" | null;
  valor_causa: number | null;
  valor_provisionado: number | null;
  data_distribuicao: string | null;
  data_encerramento: string | null;
  resultado: string | null;
  segredo_justica: boolean;
  link_autos: string | null;
  departamento_id: string | null;
  responsavel_id: string | null;
  equipe: string[];
  tags: string[];
  observacoes: string | null;
  datajud_monitorar?: boolean;
  datajud_sincronizado_em?: string | null;
  datajud_atualizado_em?: string | null;
  datajud_status?: "ok" | "nao_encontrado" | "erro" | "indisponivel" | null;
  datajud_erro?: string | null;
  drive_folder_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessoParte {
  id: string;
  processo_id: string;
  tipo: "autor" | "reu" | "terceiro" | "advogado_contrario" | "perito" | "testemunha";
  nome: string;
  documento: string | null;
  oab: string | null;
  contato: string | null;
  observacoes: string | null;
}

export interface ProcessoAndamento {
  id: string;
  processo_id: string;
  data: string;
  tipo: string;
  descricao: string;
  autor_id: string | null;
  origem?: "manual" | "sistema" | "datajud" | "publicacao";
  data_hora?: string | null;
  created_at: string;
}

export interface Prazo {
  id: string;
  processo_id: string | null;
  descricao: string;
  data_publicacao: string | null;
  dias: number | null;
  contagem: "uteis" | "corridos";
  data_fim: string;
  fatal: boolean;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  status: "pendente" | "cumprido" | "perdido" | "cancelado";
  responsavel_id: string | null;
  departamento_id: string | null;
  cumprido_em: string | null;
  observacoes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Audiencia {
  id: string;
  processo_id: string;
  tipo: "conciliacao" | "instrucao" | "una" | "julgamento" | "mediacao" | "outra";
  data_hora: string;
  duracao_min: number;
  modalidade: "presencial" | "virtual" | "hibrida";
  local: string | null;
  link: string | null;
  responsavel_id: string | null;
  preposto: string | null;
  status: "agendada" | "realizada" | "redesignada" | "cancelada";
  resultado: string | null;
  agenda_evento_id: string | null;
  created_by: string | null;
}

export interface ProcessoLancamento {
  id: string;
  processo_id: string;
  tipo: string;
  descricao: string | null;
  valor: number;
  data: string;
  vencimento: string | null;
  status: "previsto" | "pago" | "recebido" | "cancelado";
  created_by: string | null;
}

// ---------------------------------------------------------------- Escritório

export interface ContratoHonorarios {
  id: string;
  numero: string | null;
  titulo: string;
  cliente_id: string;
  processo_id: string | null;
  tipo: "fixo" | "mensal" | "exito" | "por_ato" | "hora" | "misto";
  valor_fixo: number | null;
  valor_mensal: number | null;
  percentual_exito: number | null;
  valor_hora: number | null;
  parcelas: number;
  dia_vencimento: number | null;
  data_inicio: string;
  data_fim: string | null;
  indice_reajuste: string | null;
  status: "proposta" | "ativo" | "suspenso" | "encerrado" | "cancelado";
  responsavel_id: string | null;
  departamento_id: string | null;
  observacoes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface FinanceiroLancamento {
  id: string;
  tipo: "receita" | "despesa";
  categoria: string;
  descricao: string;
  valor: number;
  vencimento: string;
  data_pagamento: string | null;
  valor_pago: number | null;
  status: "aberto" | "pago" | "cancelado";
  forma_pagamento: string | null;
  cliente_id: string | null;
  processo_id: string | null;
  contrato_id: string | null;
  departamento_id: string | null;
  fornecedor: string | null;
  parcela: number | null;
  total_parcelas: number | null;
  reembolsavel: boolean;
  documento_ref: string | null;
  observacoes: string | null;
  created_by: string | null;
  created_at: string;
}


export interface Atendimento {
  id: string;
  cliente_id: string | null;
  nome_contato: string;
  telefone: string | null;
  email: string | null;
  canal: string;
  data: string;
  area: string;
  assunto: string;
  relato: string | null;
  urgencia: "baixa" | "media" | "alta" | "urgente";
  status: "novo" | "em_analise" | "proposta_enviada" | "contratado" | "recusado" | "arquivado";
  valor_estimado: number | null;
  responsavel_id: string | null;
  departamento_id: string | null;
  processo_id: string | null;
  contrato_id: string | null;
  motivo_recusa: string | null;
  created_by: string | null;
  created_at: string;
}


export interface ModeloDocumento {
  id: string;
  titulo: string;
  categoria: string;
  area: string | null;
  descricao: string | null;
  conteudo: string;
  departamento_id: string | null;
  ativo: boolean;
  created_by: string | null;
  updated_at: string;
}

// ------------------------------------------------------------------ Rotas e check-in (fase 5)
export type RotaStatus = "planejada" | "em_andamento" | "concluida" | "aprovada" | "cancelada";
export type ParadaStatus = "pendente" | "visitada" | "nao_realizada" | "reagendada";
export type DespesaStatus = "lancada" | "aprovada" | "recusada" | "reembolsada";

export interface Rota {
  id: string;
  nome: string;
  data: string;
  consultor_id: string;
  veiculo_id: string | null;
  status: RotaStatus;
  objetivo: string | null;
  km_planejado: number | null;
  tempo_planejado_min: number | null;
  metodo_km: "linha_reta" | "google" | "rastreio" | "hodometro";
  iniciada_em: string | null;
  inicio_lat: number | null;
  inicio_lng: number | null;
  finalizada_em: string | null;
  fim_lat: number | null;
  fim_lng: number | null;
  hodometro_inicio: number | null;
  hodometro_fim: number | null;
  hodometro_foto_inicio: string | null;
  hodometro_foto_fim: string | null;
  resumo: RotaResumo | null;
  aprovada_por: string | null;
  aprovada_em: string | null;
  observacoes: string | null;
  created_at: string;
}

export interface RotaResumo {
  km: number;
  metodo_km: string;
  km_linha_reta: number;
  tempo_locomocao_min: number;
  tempo_visita_min: number;
  paradas: number;
  visitadas: number;
  nao_realizadas: number;
  fora_do_raio: number;
  inconsistencias: number;
  adquiridos: number;
  custo_km: number;
  despesas_aprovadas: number;
  despesas_pendentes: number;
  custo_total: number;
  custo_por_visitado: number | null;
  custo_por_adquirido: number | null;
}

export interface RotaParada {
  id: string;
  rota_id: string;
  ordem: number;
  tipo: "cliente" | "cidade" | "endereco" | "ponto_interesse";
  cliente_id: string | null;
  titulo: string;
  endereco: string | null;
  cidade: string | null;
  uf: string | null;
  lat: number | null;
  lng: number | null;
  raio_m: number | null;
  janela_inicio: string | null;
  janela_fim: string | null;
  objetivo: string | null;
  obrigatoria: boolean;
  status: ParadaStatus;
  motivo: string | null;
  reagendada_para: string | null;
}

export interface CheckinRota {
  id: string;
  rota_id: string;
  parada_id: string | null;
  consultor_id: string;
  tipo: "chegada" | "saida";
  registrado_em: string;
  dispositivo_em: string | null;
  lat: number;
  lng: number;
  precisao: number | null;
  distancia_m: number | null;
  dentro_do_raio: boolean | null;
  justificativa: string | null;
  foto_path: string | null;
  resultado: string | null;
  observacao: string | null;
  flags: string[];
  revisao: "pendente" | "aprovado" | "rejeitado" | null;
}

export interface DespesaRota {
  id: string;
  rota_id: string | null;
  consultor_id: string;
  tipo: string;
  valor: number;
  data: string;
  descricao: string | null;
  comprovante_path: string | null;
  hodometro: number | null;
  status: DespesaStatus;
  aprovador_id: string | null;
  aprovado_em: string | null;
  motivo: string | null;
  created_at: string;
}
