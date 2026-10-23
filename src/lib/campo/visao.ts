/**
 * Visão computacional mínima do scanner (sem dependências; roda no navegador e nos testes):
 * tons de cinza, limiar de Otsu, foco (variância do laplaciano), detecção das bordas do documento
 * (maior região clara) e homografia para corrigir a perspectiva.
 */
export type Canto = { x: number; y: number };
export type Quad = [Canto, Canto, Canto, Canto]; // superior-esquerdo, superior-direito, inferior-direito, inferior-esquerdo

export function tonsDeCinza(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return g;
}

export function brilhoMedio(g: Uint8Array): number {
  let s = 0;
  for (const v of g) s += v;
  return g.length ? s / g.length : 0;
}

/** Limiar que separa melhor duas classes (fundo × documento). */
export function limiarOtsu(g: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of g) hist[v]++;
  const total = g.length;
  let soma = 0;
  for (let i = 0; i < 256; i++) soma += i * hist[i];
  let somaB = 0, pesoB = 0, melhor = 0, limiar = 127;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    somaB += t * hist[t];
    const mB = somaB / pesoB;
    const mF = (soma - somaB) / pesoF;
    const entre = pesoB * pesoF * (mB - mF) ** 2;
    if (entre > melhor) { melhor = entre; limiar = t; }
  }
  return limiar;
}

/** Nitidez: variância do laplaciano (foto tremida/fora de foco => valor baixo). */
export function varianciaLaplaciano(g: Uint8Array, w: number, h: number): number {
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      s += l; s2 += l * l; n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

/**
 * Cantos do documento: maior região conectada acima do limiar (papel claro sobre fundo mais escuro).
 * Retorna null quando não há região que ocupe pelo menos `minArea` da imagem.
 */
export function detectarDocumento(g0: Uint8Array, w: number, h: number, minArea = 0.15): Quad | null {
  // desfoque (média em caixa) antes do limiar: o texto escuro do documento não pode "quebrar" o papel em pedaços
  const g = desfocar(g0, w, h, Math.max(1, Math.round(Math.min(w, h) * 0.02)));
  const t = limiarOtsu(g);
  const visto = new Uint8Array(w * h);
  const fila = new Int32Array(w * h);
  let melhor: { area: number; tl: Canto; tr: Canto; br: Canto; bl: Canto } | null = null;
  for (let ini = 0; ini < g.length; ini++) {
    if (visto[ini] || g[ini] <= t) continue;
    let ini_f = 0, fim_f = 0, area = 0;
    fila[fim_f++] = ini; visto[ini] = 1;
    let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
    let tl: Canto = { x: 0, y: 0 }, br: Canto = { x: 0, y: 0 }, tr: Canto = { x: 0, y: 0 }, bl: Canto = { x: 0, y: 0 };
    while (ini_f < fim_f) {
      const i = fila[ini_f++];
      const x = i % w, y = (i - x) / w;
      area++;
      const s = x + y, d = x - y;
      if (s < sMin) { sMin = s; tl = { x, y }; }
      if (s > sMax) { sMax = s; br = { x, y }; }
      if (d > dMax) { dMax = d; tr = { x, y }; }
      if (d < dMin) { dMin = d; bl = { x, y }; }
      const viz = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const k of viz) if (k >= 0 && !visto[k] && g[k] > t) { visto[k] = 1; fila[fim_f++] = k; }
    }
    if (!melhor || area > melhor.area) melhor = { area, tl, tr, br, bl };
  }
  if (!melhor || melhor.area < minArea * w * h) return null;
  return [melhor.tl, melhor.tr, melhor.br, melhor.bl];
}

/** Média em caixa (2r+1)² com imagem integral — O(w·h) qualquer que seja o raio. */
export function desfocar(g: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let linha = 0;
    for (let x = 0; x < w; x++) {
      linha += g[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + linha;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const soma = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = soma / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** Resolve A·x = b (eliminação de Gauss com pivotamento). */
function resolver(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error("Pontos degenerados");
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/** Matriz 3×3 (linha a linha, h33 = 1) que leva os 4 pontos `de` para os 4 pontos `para`. */
export function homografia(de: Quad, para: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = de[i];
    const { x: u, y: v } = para[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...resolver(A, b), 1];
}

export function aplicar(H: number[], p: Canto): Canto {
  const z = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / z, y: (H[3] * p.x + H[4] * p.y + H[5]) / z };
}

/** Tamanho de saída do documento endireitado (média dos lados opostos). */
export function tamanhoSaida(q: Quad): { w: number; h: number } {
  const d = (a: Canto, b: Canto) => Math.hypot(a.x - b.x, a.y - b.y);
  return { w: Math.round((d(q[0], q[1]) + d(q[3], q[2])) / 2), h: Math.round((d(q[0], q[3]) + d(q[1], q[2])) / 2) };
}

export interface Qualidade {
  ok: boolean;
  brilho: number;
  nitidez: number;
  problemas: string[];
}

/** Validação antes de aceitar a página: foco, brilho e documento inteiro (cantos dentro da foto). */
export function avaliarQualidade(g: Uint8Array, w: number, h: number, quad: Quad | null): Qualidade {
  const brilho = brilhoMedio(g);
  const nitidez = varianciaLaplaciano(g, w, h);
  const problemas: string[] = [];
  if (brilho < 60) problemas.push("Foto escura: procure mais luz.");
  if (brilho > 235) problemas.push("Foto estourada: evite reflexo ou luz direta.");
  if (nitidez < 40) problemas.push("Foto tremida ou fora de foco: segure firme e toque para focar.");
  if (!quad) problemas.push("Documento não encontrado: enquadre o documento inteiro sobre um fundo escuro.");
  else if (quad.some((c) => c.x <= 1 || c.y <= 1 || c.x >= w - 2 || c.y >= h - 2)) problemas.push("Documento cortado: afaste o celular para enquadrar as quatro bordas.");
  return { ok: problemas.length === 0, brilho, nitidez, problemas };
}
