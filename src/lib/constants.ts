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
  { value: "consultor", label: "Assessor interno", tone: "sky" },
  { value: "consultor_externo", label: "Assessor externo", tone: "accent" },
];
export const ROLE_LABEL: Record<AppRole, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label])) as Record<AppRole, string>;

export const AREAS: (Option & { value: Area; href: string; descricao: string })[] = [
  { value: "consultor", label: "Comercial", href: "/consultor", tone: "accent", descricao: "Cadastro de clientes, assessores, documentos e visitas" },
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
  { value: "consultor", label: "Comercial", tone: "accent" },
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
  { value: "paga", label: "Paga ao assessor", tone: "green" },
  { value: "estornada", label: "Estornada", tone: "red" },
];

export const META_TIPOS: Option[] = [
  { value: "consorcio_credito", label: "Crédito vendido (consórcio)" },
  { value: "seguro_premio", label: "Prêmio emitido (seguros)" },
  { value: "novos_clientes", label: "Novos clientes" },
  { value: "comissao", label: "Comissão gerada" },
  { value: "analises", label: "Processos analisados (saíram de “em análise”)" },
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
  { value: "documentos_pessoais", label: "Documentos pessoais" },
  { value: "contrato_assinado", label: "Contrato assinado" },
  { value: "outros", label: "Outros" },
];

/** Tipos de ação do cadastro comercial (o valor é o mesmo usado na base de processos). */
export const TIPOS_ACAO: Option[] = [
  { value: "Salário Materno", label: "Salário-maternidade" },
  { value: "Aposentadoria", label: "Aposentadoria" },
  { value: "Auxílio Doença", label: "Auxílio-doença" },
  { value: "Pensão por Morte", label: "Pensão por morte" },
  { value: "BPC Deficiente", label: "BPC – pessoa com deficiência" },
  { value: "BPC Idoso", label: "BPC – idoso" },
  { value: "Trabalhista", label: "Trabalhista" },
  { value: "Outro", label: "Outro" },
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

// ---------------------------------------------------------------- Leads e WhatsApp (fase 6)
export const LEAD_STATUS: Option[] = [
  { value: "novo", label: "Novo", tone: "accent" },
  { value: "em_contato", label: "Em contato", tone: "sky" },
  { value: "qualificado", label: "Qualificado", tone: "brand" },
  { value: "convertido", label: "Convertido", tone: "green" },
  { value: "descartado", label: "Descartado", tone: "slate" },
];
export const LEAD_ORIGENS: Option[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "site", label: "Site / formulário" },
  { value: "lead_ads", label: "Facebook / Instagram" },
  { value: "indicacao", label: "Indicação" },
  { value: "consultor", label: "Assessor" },
  { value: "importacao", label: "Importação" },
  { value: "outro", label: "Outro" },
];
export const DISTRIBUICAO_CRITERIOS: Option[] = [
  { value: "qualquer", label: "Qualquer lead/conversa" },
  { value: "cidade", label: "Cidade" },
  { value: "ddd", label: "DDD do telefone" },
  { value: "origem", label: "Origem" },
  { value: "interesse", label: "Interesse contém" },
  { value: "campanha", label: "Campanha contém" },
];
export const WA_CONVERSA_STATUS: Option[] = [
  { value: "aberta", label: "Aberta", tone: "slate" },
  { value: "aguardando_atendente", label: "Aguardando atendente", tone: "amber" },
  { value: "aguardando_cliente", label: "Aguardando cliente", tone: "sky" },
  { value: "resolvida", label: "Resolvida", tone: "green" },
  { value: "arquivada", label: "Arquivada", tone: "slate" },
];
export const WA_RESULTADOS: Option[] = [
  { value: "venda", label: "Venda / proposta" },
  { value: "duvida", label: "Dúvida respondida" },
  { value: "documento_recebido", label: "Documento recebido" },
  { value: "suporte", label: "Suporte" },
  { value: "sem_retorno", label: "Sem retorno do cliente" },
  { value: "outro", label: "Outro" },
];
export const WA_CAMPANHA_STATUS: Option[] = [
  { value: "rascunho", label: "Rascunho", tone: "slate" },
  { value: "agendada", label: "Agendada", tone: "accent" },
  { value: "enviando", label: "Enviando", tone: "sky" },
  { value: "concluida", label: "Concluída", tone: "green" },
  { value: "cancelada", label: "Cancelada", tone: "red" },
];
export const WA_MODELO_CATEGORIAS: Option[] = [
  { value: "utility", label: "Utilidade (avisos, documentos)" },
  { value: "marketing", label: "Marketing (exige opt-in)" },
  { value: "authentication", label: "Autenticação" },
];

// ---------------------------------------------------------------- RH, ponto e folha (fase 7)
export const PONTO_TIPOS: Option[] = [
  { value: "entrada", label: "Entrada" },
  { value: "intervalo_inicio", label: "Início do intervalo" },
  { value: "intervalo_fim", label: "Fim do intervalo" },
  { value: "saida", label: "Saída" },
];
export const APROVACAO_STATUS: Option[] = [
  { value: "pendente", label: "Pendente", tone: "amber" },
  { value: "aprovado", label: "Aprovado", tone: "green" },
  { value: "recusado", label: "Recusado", tone: "red" },
];
export const AUSENCIA_TIPOS: Option[] = [
  { value: "ferias", label: "Férias" },
  { value: "atestado", label: "Atestado médico" },
  { value: "afastamento", label: "Afastamento" },
  { value: "licenca", label: "Licença" },
  { value: "falta_justificada", label: "Falta justificada" },
  { value: "folga_banco", label: "Folga (banco de horas)" },
];
export const TIPOS_CONTRATO: Option[] = [
  { value: "clt", label: "CLT" },
  { value: "pj", label: "PJ" },
  { value: "estagio", label: "Estágio" },
  { value: "temporario", label: "Temporário" },
  { value: "autonomo", label: "Autônomo" },
  { value: "socio", label: "Sócio" },
  { value: "nao_informado", label: "Não informado" },
];
export const FUNCIONARIO_STATUS: Option[] = [
  { value: "ativo", label: "Ativo", tone: "green" },
  { value: "ferias", label: "Férias", tone: "sky" },
  { value: "afastado", label: "Afastado", tone: "amber" },
  { value: "desligado", label: "Desligado", tone: "slate" },
];
export const FOLHA_STATUS: Option[] = [
  { value: "em_revisao", label: "Em revisão", tone: "amber" },
  { value: "aprovada", label: "Aprovada", tone: "green" },
  { value: "exportada", label: "Exportada", tone: "brand" },
  { value: "cancelada", label: "Cancelada", tone: "slate" },
];

// ---------------------------------------------------------------- Vendas e relatórios (fase 9)
export const SITUACOES_VENDA: Option[] = [
  { value: "em_negociacao", label: "Em negociação", tone: "slate" },
  { value: "enviada", label: "Proposta enviada", tone: "sky" },
  { value: "aprovada", label: "Aprovada", tone: "green" },
  { value: "cancelada", label: "Cancelada", tone: "red" },
  { value: "pendente_confirmacao", label: "Pendente de confirmação", tone: "amber" },
];
export const SITUACOES_ENCAMINHAMENTO: Option[] = [
  { value: "encaminhado", label: "Encaminhado", tone: "sky" },
  { value: "em_analise", label: "Em análise", tone: "violet" },
  { value: "ajuizado", label: "Ajuizado", tone: "green" },
  { value: "cancelado", label: "Cancelado", tone: "red" },
  { value: "pendente_confirmacao", label: "Falta confirmação", tone: "amber" },
];

/** Situação do processo administrativo (benefício INSS) — calculada pelo banco a partir dos dados do processo. */
export const CASO_STATUS: Option[] = [
  { value: "em_analise", label: "Em análise", tone: "sky" },
  { value: "pendencia", label: "Pendência", tone: "amber" },
  { value: "exigencia", label: "Exigência", tone: "red" },
  { value: "habilitacao", label: "Para habilitação", tone: "accent" },
  { value: "habilitado", label: "Habilitado", tone: "green" },
  { value: "deferido", label: "Deferido", tone: "green" },
  { value: "indeferido", label: "Indeferido", tone: "red" },
  { value: "aguardando_idade", label: "Aguardando idade", tone: "brand" },
  { value: "judicializado", label: "Judicializado", tone: "violet" },
  { value: "arquivo_morto", label: "Arquivo morto", tone: "slate" },
  { value: "outros", label: "Outros", tone: "slate" },
];

/** Status que só funcionários autorizados enxergam (funcionalidade processos.status_restritos). */
export const CASO_STATUS_RESTRITOS = ["pendencia", "exigencia", "em_analise"] as const;

export const CASO_PENDENCIAS: Option[] = [
  { value: "assinatura", label: "Falta assinatura (contrato/procuração)", tone: "amber" },
  { value: "documentacao", label: "Documentação", tone: "amber" },
  { value: "contato", label: "Sem contato / sem retorno", tone: "amber" },
  { value: "desistencia", label: "Desistência", tone: "red" },
];

// ---------------------------------------------------------------- Metas de processos, assessores e rotas (2026-11)
export const META_INDICADORES: Option[] = [
  { value: "processos_novos", label: "Processos/clientes novos", tone: "brand" },
  { value: "habilitados", label: "Habilitações no INSS", tone: "green" },
  { value: "judicializados", label: "Processos judicializados", tone: "violet" },
  { value: "analises", label: "Processos analisados", tone: "sky" },
  { value: "ligacoes", label: "Ligações para clientes", tone: "accent" },
  { value: "pendencias_resolvidas", label: "Pendências resolvidas", tone: "amber" },
  { value: "exigencias_cumpridas", label: "Exigências cumpridas", tone: "red" },
];
export const META_PERIODICIDADES: Option[] = [
  { value: "diaria", label: "Por dia" },
  { value: "mensal", label: "Por mês" },
  { value: "anual", label: "Por ano" },
];
export const META_ALVOS: Option[] = [
  { value: "empresa", label: "Geral (toda a empresa)" },
  { value: "assessor", label: "Um assessor/consultor (o que ele trouxe)" },
  { value: "usuario", label: "Um funcionário (o que ele fez)" },
  { value: "categoria", label: "Cada assessor de uma categoria" },
];
export const ASSESSOR_CATEGORIAS: Option[] = [
  { value: "consultor", label: "Consultor", tone: "brand" },
  { value: "corretor", label: "Corretor", tone: "accent" },
  { value: "diretoria", label: "Diretoria", tone: "violet" },
];
export const ROTA_OBJETIVOS: Option[] = [
  { value: "prospeccao", label: "Prospecção de clientes", tone: "brand" },
  { value: "atender_corretor", label: "Atender corretor(es)", tone: "accent" },
  { value: "pendencias", label: "Resolver pendências", tone: "amber" },
];
export const NIVEIS_TANQUE: Option[] = [
  { value: "reserva", label: "Reserva" },
  { value: "1/4", label: "1/4" },
  { value: "1/2", label: "1/2" },
  { value: "3/4", label: "3/4" },
  { value: "cheio", label: "Cheio" },
];
export const INCONSISTENCIAS: (Option & { descricao: string; gravidade: "alta" | "media" | "baixa" })[] = [
  { value: "exigencia_vencida", label: "Exigência com prazo vencido", descricao: "Prazo de 7 dias (+7 de prorrogação) estourado", gravidade: "alta", tone: "red" },
  { value: "documentacao_vencida", label: "Documentação do cadastro vencida", descricao: "Prazo de coleta de documentos encerrado", gravidade: "alta", tone: "red" },
  { value: "habilitado_sem_protocolo", label: "Habilitado sem protocolo do INSS", descricao: "Todo processo habilitado precisa do número de protocolo", gravidade: "alta", tone: "red" },
  { value: "sem_assinatura", label: "Falta contrato ou procuração assinados", descricao: "Assinaturas pendentes em processos ativos", gravidade: "alta", tone: "amber" },
  { value: "exigencia_sem_status", label: "Exigência em aberto com outro status", descricao: "A planilha indica exigência, mas o status não é Exigência", gravidade: "media", tone: "amber" },
  { value: "analise_parada", label: "Em análise há mais de 60 dias", descricao: "Processos parados na análise", gravidade: "media", tone: "amber" },
  { value: "duplicado", label: "Processos duplicados", descricao: "Mesmo cliente e mesmo tipo com mais de um processo ativo", gravidade: "media", tone: "amber" },
  { value: "datas_invalidas", label: "Datas inconsistentes", descricao: "Habilitação antes do recebimento ou data no futuro", gravidade: "media", tone: "amber" },
  { value: "habilitado_sem_data", label: "Habilitado sem data de habilitação", descricao: "Status habilitado sem a data", gravidade: "media", tone: "amber" },
  { value: "sem_assessor", label: "Processo sem assessor", descricao: "Não dá para medir a meta de quem trouxe o cliente", gravidade: "baixa", tone: "slate" },
  { value: "cliente_sem_cpf", label: "Cliente sem CPF válido", descricao: "CPF ausente ou com quantidade de dígitos errada", gravidade: "media", tone: "amber" },
  { value: "cliente_sem_telefone", label: "Cliente sem telefone", descricao: "Sem telefone, WhatsApp ou recado", gravidade: "baixa", tone: "slate" },
  { value: "rota_sem_checklist", label: "Rota sem checklist do veículo", descricao: "Rota concluída sem o checklist de saída ou de chegada", gravidade: "media", tone: "amber" },
];

// ---------------------------------------------------------------- Resumo do dia (consultor/assessor)
export const LIGACAO_RESULTADOS: Option[] = [
  { value: "atendeu", label: "Atendeu", tone: "green" },
  { value: "nao_atendeu", label: "Não atendeu", tone: "slate" },
  { value: "agendou", label: "Agendou", tone: "brand" },
  { value: "retornar", label: "Retornar", tone: "amber" },
  { value: "fechou", label: "Fechou / cadastrou", tone: "green" },
  { value: "numero_errado", label: "Número errado", tone: "red" },
];
export const DIA_AVALIACOES: Option[] = [
  { value: "otimo", label: "Ótimo", tone: "green" },
  { value: "bom", label: "Bom", tone: "brand" },
  { value: "regular", label: "Regular", tone: "amber" },
  { value: "dificil", label: "Difícil", tone: "red" },
];

// ---------------------------------------------------------------- Ficha de acompanhamento de pendências (2026-11)
export const FICHA_BENEFICIOS: Option[] = [
  { value: "aux_doenca", label: "Aux. doença" },
  { value: "bpc", label: "BPC" },
  { value: "aposentadoria", label: "Aposent." },
  { value: "sal_maternidade", label: "Sal. matern." },
  { value: "pensao", label: "Pensão" },
  { value: "outro", label: "Outro" },
];
export const FICHA_SEGURADOS: Option[] = [
  { value: "rural", label: "Rural" },
  { value: "pescador", label: "Pescador" },
  { value: "urbano", label: "Urbano" },
];
export const FICHA_DESTINOS: Option[] = [
  { value: "analise", label: "Análise", tone: "sky" },
  { value: "habilitacao", label: "Habilitação", tone: "accent" },
  { value: "exigencia", label: "Exigência", tone: "red" },
  { value: "pendencia", label: "Pendência", tone: "amber" },
  { value: "habilitado", label: "Habilitado", tone: "green" },
  { value: "outro", label: "Outro", tone: "slate" },
];
/** Destinos oferecidos ao encerrar cada tipo de ficha (análise da Tati ou habilitação da Aline, entre os setores). */
export const FICHA_DESTINOS_POR_TIPO: Record<"pendencia" | "exigencia", string[]> = {
  pendencia: ["analise", "habilitacao", "exigencia", "outro"],
  exigencia: ["analise", "habilitacao", "pendencia", "outro"],
};
export const FICHA_TIPOS = {
  pendencia: { titulo: "Pendências", ficha: "Folha de acompanhamento de pendências", status: "pendencia", rota: "/administrativo/pendencias", perm: "fichas.pendencias" },
  exigencia: { titulo: "Exigências", ficha: "Folha de acompanhamento de exigências", status: "exigencia", rota: "/administrativo/exigencias", perm: "fichas.exigencias" },
} as const;
export type FichaTipo = keyof typeof FICHA_TIPOS;
/** Benefício da ficha sugerido pelo tipo do processo (planilha/cadastro). */
export function beneficioDoTipo(tipo: string | null | undefined): string | null {
  const t = (tipo ?? "").toLowerCase();
  if (t.includes("doen")) return "aux_doenca";
  if (t.includes("bpc")) return "bpc";
  if (t.includes("aposent")) return "aposentadoria";
  if (t.includes("mater")) return "sal_maternidade";
  if (t.includes("pens")) return "pensao";
  return t ? "outro" : null;
}
