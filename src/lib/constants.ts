import type { AppRole, Area } from "./types";

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
  { value: "advogado", label: "Advogado(a)", tone: "brand" },
  { value: "assistente_juridico", label: "Assistente jurídico", tone: "sky" },
  { value: "administrativo", label: "Administrativo", tone: "slate" },
  { value: "consultor", label: "Consultor interno", tone: "sky" },
  { value: "consultor_externo", label: "Consultor externo", tone: "accent" },
];
export const ROLE_LABEL: Record<AppRole, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<AppRole, string>;

export const AREAS: (Option & { value: Area; href: string; descricao: string })[] = [
  { value: "consultor", label: "Consultor", href: "/consultor", tone: "accent", descricao: "Carteira, pré-cadastro, documentos e visitas" },
  { value: "administrativo", label: "Administrativo", href: "/administrativo", tone: "slate", descricao: "Documentação, base de clientes e encaminhamentos" },
  { value: "juridico", label: "Jurídico", href: "/juridico", tone: "brand", descricao: "Processos, intimações e audiências" },
  { value: "rh", label: "RH", href: "/rh", tone: "sky", descricao: "Funcionários, acessos e jornada" },
  { value: "financeiro", label: "Financeiro", href: "/financeiro", tone: "green", descricao: "Contas, recebimentos e comissões" },
];

export const CADASTRO_STATUS: Option[] = [
  { value: "pre_cadastro", label: "Pré-cadastro", tone: "slate" },
  { value: "pendente_documentacao", label: "Documentação pendente", tone: "amber" },
  { value: "documentacao_completa", label: "Documentação completa", tone: "sky" },
  { value: "transferido_administrativo", label: "Transferido ao administrativo", tone: "red" },
  { value: "ativo", label: "Ativo", tone: "green" },
  { value: "perdido", label: "Perdido", tone: "slate" },
  { value: "inativo", label: "Inativo", tone: "slate" },
];

export const CARTEIRAS: Option[] = [
  { value: "consultor", label: "Consultor", tone: "accent" },
  { value: "administrativo", label: "Administrativa", tone: "slate" },
  { value: "juridico", label: "Jurídica", tone: "brand" },
];

export const DOC_ANALISE: Option[] = [
  { value: "enviado", label: "Enviado", tone: "sky" },
  { value: "em_analise", label: "Em análise", tone: "amber" },
  { value: "aprovado", label: "Aprovado", tone: "green" },
  { value: "recusado", label: "Recusado", tone: "red" },
  { value: "vencido", label: "Vencido", tone: "red" },
];

export const ENCAMINHAMENTO_STATUS: Option[] = [
  { value: "encaminhado", label: "Encaminhado", tone: "sky" },
  { value: "em_analise", label: "Em análise", tone: "amber" },
  { value: "ajuizado", label: "Ajuizado", tone: "green" },
  { value: "cancelado", label: "Cancelado", tone: "slate" },
  { value: "pendente_confirmacao", label: "Falta confirmação", tone: "red" },
];

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
  { value: "audiencia", label: "Audiência", tone: "red" },
  { value: "prazo", label: "Prazo", tone: "amber" },
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
  { value: "peticao", label: "Petições e manifestações" },
  { value: "procuracao", label: "Procuração e substabelecimento" },
  { value: "decisao", label: "Decisões, sentenças e acórdãos" },
  { value: "prova", label: "Provas e anexos" },
  { value: "laudo", label: "Laudos e perícias" },
  { value: "intimacao", label: "Intimações e citações" },
  { value: "contrato", label: "Contratos" },
  { value: "gerado", label: "Documentos gerados" },
  { value: "comprovante_pagamento", label: "Comprovantes de pagamento e custas" },
  { value: "rg_cnh", label: "RG / CNH" },
  { value: "cpf_cnpj", label: "CPF / CNPJ" },
  { value: "comprovante_residencia", label: "Comprovante de residência" },
  { value: "comprovante_renda", label: "Comprovante de renda" },
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

// ---------------------------------------------------------------- Jurídico

export const PROCESSO_AREAS: Option[] = [
  { value: "civel", label: "Cível" },
  { value: "consumidor", label: "Consumidor" },
  { value: "bancario", label: "Bancário / Consórcio" },
  { value: "trabalhista", label: "Trabalhista" },
  { value: "tributario", label: "Tributário" },
  { value: "previdenciario", label: "Previdenciário" },
  { value: "familia", label: "Família e Sucessões" },
  { value: "empresarial", label: "Empresarial" },
  { value: "administrativo", label: "Administrativo" },
  { value: "criminal", label: "Criminal" },
  { value: "outro", label: "Outro" },
];

export const PROCESSO_STATUS: Option[] = [
  { value: "ativo", label: "Ativo", tone: "green" },
  { value: "suspenso", label: "Suspenso", tone: "amber" },
  { value: "arquivado", label: "Arquivado", tone: "slate" },
  { value: "encerrado", label: "Encerrado", tone: "violet" },
];

export const PROCESSO_FASES: Option[] = [
  { value: "pre_processual", label: "Pré-processual", tone: "slate" },
  { value: "conhecimento", label: "Conhecimento", tone: "brand" },
  { value: "recursal", label: "Recursal", tone: "violet" },
  { value: "execucao", label: "Execução", tone: "accent" },
  { value: "cumprimento_sentenca", label: "Cumprimento de sentença", tone: "amber" },
  { value: "acordo", label: "Acordo", tone: "green" },
  { value: "transito_julgado", label: "Trânsito em julgado", tone: "sky" },
];

export const PROCESSO_RISCO: Option[] = [
  { value: "provavel", label: "Provável", tone: "red" },
  { value: "possivel", label: "Possível", tone: "amber" },
  { value: "remoto", label: "Remoto", tone: "green" },
];

export const PROCESSO_POLO: Option[] = [
  { value: "ativo", label: "Polo ativo (autor)" },
  { value: "passivo", label: "Polo passivo (réu)" },
  { value: "terceiro", label: "Terceiro interessado" },
];

export const INSTANCIAS: Option[] = [
  { value: "1", label: "1ª instância" },
  { value: "2", label: "2ª instância" },
  { value: "3", label: "Tribunais superiores" },
  { value: "4", label: "STF" },
];

export const PARTE_TIPOS: Option[] = [
  { value: "autor", label: "Autor / Requerente" },
  { value: "reu", label: "Réu / Requerido" },
  { value: "terceiro", label: "Terceiro" },
  { value: "advogado_contrario", label: "Advogado da parte contrária" },
  { value: "perito", label: "Perito" },
  { value: "testemunha", label: "Testemunha" },
];

export const ANDAMENTO_TIPOS: Option[] = [
  { value: "publicacao", label: "Publicação", tone: "brand" },
  { value: "intimacao", label: "Intimação", tone: "accent" },
  { value: "citacao", label: "Citação", tone: "accent" },
  { value: "despacho", label: "Despacho", tone: "slate" },
  { value: "decisao", label: "Decisão", tone: "violet" },
  { value: "sentenca", label: "Sentença", tone: "red" },
  { value: "acordao", label: "Acórdão", tone: "red" },
  { value: "peticao", label: "Petição", tone: "sky" },
  { value: "juntada", label: "Juntada", tone: "slate" },
  { value: "audiencia", label: "Audiência", tone: "amber" },
  { value: "outro", label: "Outro", tone: "slate" },
];

export const PRAZO_STATUS: Option[] = [
  { value: "pendente", label: "Pendente", tone: "amber" },
  { value: "cumprido", label: "Cumprido", tone: "green" },
  { value: "perdido", label: "Perdido", tone: "red" },
  { value: "cancelado", label: "Cancelado", tone: "slate" },
];

export const PRAZO_CONTAGEM: Option[] = [
  { value: "uteis", label: "Dias úteis (CPC art. 219)" },
  { value: "corridos", label: "Dias corridos" },
];

export const AUDIENCIA_TIPOS: Option[] = [
  { value: "conciliacao", label: "Conciliação" },
  { value: "mediacao", label: "Mediação" },
  { value: "instrucao", label: "Instrução" },
  { value: "una", label: "Una (conciliação + instrução)" },
  { value: "julgamento", label: "Julgamento" },
  { value: "outra", label: "Outra" },
];

export const AUDIENCIA_STATUS: Option[] = [
  { value: "agendada", label: "Agendada", tone: "brand" },
  { value: "realizada", label: "Realizada", tone: "green" },
  { value: "redesignada", label: "Redesignada", tone: "amber" },
  { value: "cancelada", label: "Cancelada", tone: "red" },
];

export const AUDIENCIA_MODALIDADES: Option[] = [
  { value: "presencial", label: "Presencial" },
  { value: "virtual", label: "Virtual (videoconferência)" },
  { value: "hibrida", label: "Híbrida" },
];

export const LANCAMENTO_TIPOS: Option[] = [
  { value: "custas", label: "Custas processuais" },
  { value: "despesa", label: "Despesa (diligências, cópias…)" },
  { value: "deposito_judicial", label: "Depósito judicial" },
  { value: "honorarios_contratuais", label: "Honorários contratuais" },
  { value: "honorarios_sucumbenciais", label: "Honorários sucumbenciais" },
  { value: "honorarios_exito", label: "Honorários de êxito" },
  { value: "acordo", label: "Acordo" },
  { value: "condenacao", label: "Condenação" },
];

export const LANCAMENTO_STATUS: Option[] = [
  { value: "previsto", label: "Previsto", tone: "amber" },
  { value: "pago", label: "Pago", tone: "slate" },
  { value: "recebido", label: "Recebido", tone: "green" },
  { value: "cancelado", label: "Cancelado", tone: "red" },
];

export const DEPARTAMENTO_CORES: Option[] = [
  { value: "brand", label: "Índigo", tone: "brand" },
  { value: "accent", label: "Laranja", tone: "accent" },
  { value: "green", label: "Verde", tone: "green" },
  { value: "amber", label: "Âmbar", tone: "amber" },
  { value: "red", label: "Vermelho", tone: "red" },
  { value: "sky", label: "Azul", tone: "sky" },
  { value: "violet", label: "Violeta", tone: "violet" },
  { value: "slate", label: "Cinza", tone: "slate" },
];

export const TRIBUNAIS: Option[] = [
  "TJSP", "TJRJ", "TJMG", "TJRS", "TJPR", "TJSC", "TJBA", "TJPE", "TJCE", "TJGO", "TJDFT", "TJES", "TJMA", "TJPA", "TJPB", "TJPI", "TJRN", "TJAL", "TJSE",
  "TJMT", "TJMS", "TJRO", "TJTO", "TJAC", "TJAP", "TJAM", "TJRR", "TRF1", "TRF2", "TRF3", "TRF4", "TRF5", "TRF6", "TRT1", "TRT2", "TRT3", "TRT4", "TRT5",
  "TRT15", "TST", "STJ", "STF", "Procon", "Juizado Especial", "Administrativo",
].map((v) => ({ value: v, label: v }));

// ---------------------------------------------------------------- Escritório

export const CONTRATO_TIPOS: Option[] = [
  { value: "fixo", label: "Valor fixo (à vista ou parcelado)" },
  { value: "mensal", label: "Mensal (partido / assessoria)" },
  { value: "exito", label: "Êxito (% do proveito)" },
  { value: "por_ato", label: "Por ato processual" },
  { value: "hora", label: "Por hora trabalhada" },
  { value: "misto", label: "Misto (fixo + êxito)" },
];

export const CONTRATO_STATUS: Option[] = [
  { value: "proposta", label: "Proposta", tone: "slate" },
  { value: "ativo", label: "Ativo", tone: "green" },
  { value: "suspenso", label: "Suspenso", tone: "amber" },
  { value: "encerrado", label: "Encerrado", tone: "violet" },
  { value: "cancelado", label: "Cancelado", tone: "red" },
];

export const FIN_STATUS: Option[] = [
  { value: "aberto", label: "Em aberto", tone: "amber" },
  { value: "pago", label: "Pago / recebido", tone: "green" },
  { value: "cancelado", label: "Cancelado", tone: "slate" },
];

export const FIN_CATEGORIAS_RECEITA: Option[] = [
  "Honorários contratuais", "Honorários de êxito", "Honorários sucumbenciais", "Assessoria mensal", "Consultas", "Reembolso de despesas", "Outras receitas",
].map((v) => ({ value: v, label: v }));

export const FIN_CATEGORIAS_DESPESA: Option[] = [
  "Custas processuais", "Diligências e deslocamentos", "Correspondentes", "Folha e pró-labore", "Aluguel e condomínio", "Sistemas e tecnologia",
  "Impostos e taxas", "OAB e anuidades", "Marketing", "Material de escritório", "Serviços contábeis", "Outras despesas",
].map((v) => ({ value: v, label: v }));

export const FORMAS_PAGAMENTO_ESC: Option[] = ["PIX", "Boleto", "Transferência", "Cartão de crédito", "Dinheiro", "Cheque", "Alvará judicial"].map((v) => ({ value: v, label: v }));

export const ATENDIMENTO_STATUS: Option[] = [
  { value: "novo", label: "Novo", tone: "sky" },
  { value: "em_analise", label: "Em análise", tone: "violet" },
  { value: "proposta_enviada", label: "Proposta enviada", tone: "amber" },
  { value: "contratado", label: "Contratado", tone: "green" },
  { value: "recusado", label: "Recusado", tone: "red" },
  { value: "arquivado", label: "Arquivado", tone: "slate" },
];

export const ATENDIMENTO_CANAIS: Option[] = [
  { value: "presencial", label: "Presencial" },
  { value: "telefone", label: "Telefone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "E-mail" },
  { value: "videochamada", label: "Videochamada" },
  { value: "indicacao", label: "Indicação" },
  { value: "site", label: "Site" },
];

export const PUBLICACAO_STATUS: Option[] = [
  { value: "nova", label: "Nova", tone: "accent" },
  { value: "tratada", label: "Tratada", tone: "green" },
  { value: "descartada", label: "Descartada", tone: "slate" },
];

export const MODELO_CATEGORIAS: Option[] = [
  { value: "peticao", label: "Petição" },
  { value: "procuracao", label: "Procuração" },
  { value: "contrato", label: "Contrato" },
  { value: "declaracao", label: "Declaração" },
  { value: "notificacao", label: "Notificação" },
  { value: "parecer", label: "Parecer" },
  { value: "recibo", label: "Recibo" },
  { value: "oficio", label: "Ofício" },
  { value: "outro", label: "Outro" },
];

// ------------------------------------------------------------------ Rotas e check-in (fase 5)
export const ROTA_STATUS: Option[] = [
  { value: "planejada", label: "Planejada", tone: "slate" },
  { value: "em_andamento", label: "Em andamento", tone: "accent" },
  { value: "concluida", label: "Concluída (aguarda aprovação)", tone: "sky" },
  { value: "aprovada", label: "Aprovada", tone: "green" },
  { value: "cancelada", label: "Cancelada", tone: "red" },
];
export const PARADA_STATUS: Option[] = [
  { value: "pendente", label: "Pendente", tone: "slate" },
  { value: "visitada", label: "Visitada", tone: "green" },
  { value: "nao_realizada", label: "Não realizada", tone: "red" },
  { value: "reagendada", label: "Reagendada", tone: "amber" },
];
export const PARADA_TIPOS: Option[] = [
  { value: "cliente", label: "Cliente" },
  { value: "cidade", label: "Cidade" },
  { value: "endereco", label: "Endereço" },
  { value: "ponto_interesse", label: "Ponto de interesse" },
];
export const CHECKIN_RESULTADOS: Option[] = [
  { value: "visitado", label: "Visitado", tone: "sky" },
  { value: "ausente", label: "Ausente", tone: "slate" },
  { value: "reagendado", label: "Reagendado", tone: "amber" },
  { value: "venda", label: "Venda", tone: "green" },
  { value: "recusa", label: "Recusa", tone: "red" },
  { value: "pre_cadastro", label: "Pré-cadastro", tone: "brand" },
];
export const CHECKIN_FLAGS: Record<string, string> = {
  localizacao_simulada: "Localização simulada",
  precisao_ruim: "Precisão ruim do GPS",
  horario_divergente: "Horário do aparelho divergente",
  salto_velocidade: "Salto impossível de velocidade",
  ponto_repetido: "Mesmo ponto de outra parada",
};
export const DESPESA_TIPOS: Option[] = [
  { value: "combustivel", label: "Combustível" },
  { value: "pedagio", label: "Pedágio" },
  { value: "alimentacao", label: "Alimentação" },
  { value: "estacionamento", label: "Estacionamento" },
  { value: "hospedagem", label: "Hospedagem" },
  { value: "outros", label: "Outros" },
];
export const DESPESA_STATUS: Option[] = [
  { value: "lancada", label: "Aguardando aprovação", tone: "amber" },
  { value: "aprovada", label: "Aprovada", tone: "green" },
  { value: "recusada", label: "Recusada", tone: "red" },
  { value: "reembolsada", label: "Reembolsada", tone: "brand" },
];
