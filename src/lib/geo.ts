/** Cálculos geográficos puros (check-in, rotas, quilometragem). Sem dependências: rodam no servidor e no app. */

const R = 6_371_008.8; // raio médio da Terra (m)
const rad = (g: number) => (g * Math.PI) / 180;

export interface Ponto {
  lat: number;
  lng: number;
}

/** Distância em linha reta (haversine), em metros. */
export function distanciaM(a: Ponto, b: Ponto): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const coordValida = (p: Partial<Ponto> | null | undefined): p is Ponto =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180 && !(p.lat === 0 && p.lng === 0);

/**
 * Ordem de visita por vizinho mais próximo a partir da origem (sem chave de mapas). Retorna os índices.
 * shortcut: heurística simples (até ~15% acima do ótimo); usar a Routes API do Google quando a empresa tiver chave.
 */
export function ordemVizinhoMaisProximo(origem: Ponto | null, paradas: (Ponto | null)[]): number[] {
  const restantes = paradas.map((p, i) => ({ p, i }));
  const comCoord = restantes.filter((x): x is { p: Ponto; i: number } => coordValida(x.p));
  const semCoord = restantes.filter((x) => !coordValida(x.p)).map((x) => x.i);
  const ordem: number[] = [];
  let atual: Ponto | null = coordValida(origem) ? origem : (comCoord[0]?.p ?? null);
  while (comCoord.length) {
    let melhor = 0;
    for (let k = 1; k < comCoord.length; k++) if (distanciaM(atual!, comCoord[k].p) < distanciaM(atual!, comCoord[melhor].p)) melhor = k;
    const [x] = comCoord.splice(melhor, 1);
    ordem.push(x.i);
    atual = x.p;
  }
  return [...ordem, ...semCoord];
}

/** Distância total de um percurso em linha reta (m). */
export function percursoM(pontos: Ponto[]): number {
  let t = 0;
  for (let i = 1; i < pontos.length; i++) t += distanciaM(pontos[i - 1], pontos[i]);
  return t;
}
