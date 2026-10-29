/** Pacote de dados do app de campo (espelha /api/campo/snapshot). */
export interface ParadaCampo {
  id: string;
  rota_id: string;
  ordem: number;
  tipo: string;
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
  status: string;
}
export interface CheckinCampo {
  id: string;
  rota_id: string;
  parada_id: string | null;
  tipo: "chegada" | "saida";
  registrado_em: string;
  resultado: string | null;
  dentro_do_raio: boolean | null;
  pendente?: boolean;
}
export interface RotaCampo {
  id: string;
  nome: string;
  data: string;
  status: string;
  objetivo: string | null;
  iniciada_em: string | null;
  km_planejado: number | null;
  veiculo?: { descricao: string; placa: string | null; consumo_km_l: number } | null;
  previsao?: { km: number; litros: number; combustivel: number; consumo_km_l: number } | null;
  paradas: ParadaCampo[];
  checkins: CheckinCampo[];
}
export interface Snapshot {
  gerado_em: string;
  usuario: { id: string; nome: string };
  empresa: { id: string; nome: string };
  pode: { cadastrar: boolean; rotas: boolean; despesas: boolean; ponto: boolean; leads: boolean };
  parametros: { raio_m: number; fora_do_raio: "justificar" | "bloquear"; exigir_hodometro: boolean; exigir_selfie: boolean };
  termo_lgpd: { versao: string; texto: string };
  rotas: RotaCampo[];
  pendencias: { id: string; nome: string; cidade: string | null; prazo_documentacao: string | null; faltando: string[] | null }[];
  carteira: { id: string; nome: string; documento: string | null; cidade: string | null; status_cadastro: string }[];
  documento_tipos: { categoria: string; nome: string; obrigatorio: boolean }[];
  contadores: { despesas_pendentes: number; leads_novos: number };
  ponto_hoje: { id: string; tipo: string; registrado_em: string }[];
}

export type Tela = "inicio" | "rota" | "cadastro" | "scanner" | "despesa" | "ponto" | "fila" | "ajustes";

interface Posicao {
  lat: number;
  lng: number;
  precisao: number | null;
  em: string;
}

/** Posição atual pelo GPS (alta precisão). */
export function posicaoAtual(timeoutMs = 20000): Promise<Posicao> {
  return new Promise((ok, falha) => {
    if (!navigator.geolocation) return falha(new Error("Este aparelho não oferece localização."));
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, em: new Date(p.timestamp || Date.now()).toISOString() }),
      (e) => falha(new Error(e.code === e.PERMISSION_DENIED ? "Permita a localização para este app nas configurações do navegador." : e.code === e.TIMEOUT ? "O GPS demorou a responder. Tente em local aberto." : "Não foi possível obter a localização.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
