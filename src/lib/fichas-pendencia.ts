/** Tipos e consulta da Folha de Acompanhamento de Pendências (tela e impressão). */
export interface FichaCompleta {
  id: string;
  caso_id: string;
  cliente_id: string;
  numero: number;
  beneficio: string | null;
  segurado: string | null;
  recebida_em: string;
  responsavel_id: string | null;
  status: string;
  destino: string | null;
  destino_status: string | null;
  destino_outro: string | null;
  destino_em: string | null;
  encaminhado_para: string | null;
  assinatura_path: string | null;
  encerrada_em: string | null;
  clientes: { nome: string; documento: string | null } | null;
  cliente_casos: { tipo: string; ano: number | null; status: string; protocolo_inss: string | null; situacao_atual: string | null; recebido_em: string | null } | null;
}
export interface ItemFicha {
  id: string;
  secao: "pendencia" | "retorno";
  data: string;
  texto: string;
  prazo: string | null;
  resolvida: boolean;
  criado_por: string | null;
  created_at: string;
}

export const SELECT_FICHA =
  "id, caso_id, cliente_id, numero, beneficio, segurado, recebida_em, responsavel_id, status, destino, destino_status, destino_outro, destino_em, encaminhado_para, assinatura_path, encerrada_em, clientes(nome, documento), cliente_casos(tipo, ano, status, protocolo_inss, situacao_atual, recebido_em)";
