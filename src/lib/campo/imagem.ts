"use client";
import { avaliarQualidade, detectarDocumento, homografia, aplicar, limiarOtsu, tamanhoSaida, tonsDeCinza, type Qualidade, type Quad } from "./visao";

/** Processamento das fotos do scanner no aparelho (canvas): carregar, detectar, endireitar, filtrar, comprimir. */
export type Filtro = "cor" | "cinza" | "pb";

const MAX_LADO = 2000; // foto de trabalho
const ANALISE = 400; // versão reduzida para detectar bordas e avaliar qualidade

export async function carregarImagem(arquivo: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const k = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

interface Analise {
  quad: Quad; // nos pixels da imagem de trabalho
  detectado: boolean;
  qualidade: Qualidade;
}

/** Detecta o documento e avalia a qualidade (numa cópia reduzida, rápido no celular). */
export function analisar(c: HTMLCanvasElement): Analise {
  const k = Math.min(1, ANALISE / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const p = document.createElement("canvas");
  p.width = w; p.height = h;
  const ctx = p.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, w, h);
  const g = tonsDeCinza(ctx.getImageData(0, 0, w, h).data, w, h);
  const q = detectarDocumento(g, w, h);
  const qualidade = avaliarQualidade(g, w, h, q);
  const inteiro: Quad = [{ x: 0, y: 0 }, { x: c.width - 1, y: 0 }, { x: c.width - 1, y: c.height - 1 }, { x: 0, y: c.height - 1 }];
  return { quad: q ? (q.map((v) => ({ x: v.x / k, y: v.y / k })) as Quad) : inteiro, detectado: !!q, qualidade };
}

/** Corrige a perspectiva (mapeamento inverso com interpolação bilinear) e aplica o filtro. */
export function endireitar(c: HTMLCanvasElement, quad: Quad, filtro: Filtro): HTMLCanvasElement {
  const { w, h } = tamanhoSaida(quad);
  const W = Math.max(50, Math.min(w, 2400)), Hh = Math.max(50, Math.min(h, 3200));
  const destino: Quad = [{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: Hh - 1 }, { x: 0, y: Hh - 1 }];
  const Hinv = homografia(destino, quad); // destino -> origem
  const src = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  const out = new ImageData(W, Hh);
  const sw = src.width, sh = src.height, s = src.data, o = out.data;
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const p = aplicar(Hinv, { x, y });
      const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) continue;
      const fx = p.x - x0, fy = p.y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const j = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        o[j + k] = (s[i00 + k] * (1 - fx) + s[i10 + k] * fx) * (1 - fy) + (s[i01 + k] * (1 - fx) + s[i11 + k] * fx) * fy;
      }
      o[j + 3] = 255;
    }
  }
  aplicarFiltro(out, filtro);
  const r = document.createElement("canvas");
  r.width = W; r.height = Hh;
  r.getContext("2d")!.putImageData(out, 0, 0);
  return r;
}

/** Cor: realce de contraste (estica 1%–99%); cinza; preto e branco (limiar de Otsu). */
function aplicarFiltro(img: ImageData, filtro: Filtro) {
  const d = img.data;
  const g = tonsDeCinza(d, img.width, img.height);
  if (filtro === "pb") {
    const t = limiarOtsu(g);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) { const v = g[i] > t ? 255 : 0; d[j] = d[j + 1] = d[j + 2] = v; }
    return;
  }
  const hist = new Array<number>(256).fill(0);
  for (const v of g) hist[v]++;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > g.length * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > g.length * 0.01) { hi = v; break; } }
  const k = hi > lo ? 255 / (hi - lo) : 1;
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    if (filtro === "cinza") { const v = Math.max(0, Math.min(255, (g[i] - lo) * k)); d[j] = d[j + 1] = d[j + 2] = v; }
    else for (let c = 0; c < 3; c++) d[j + c] = Math.max(0, Math.min(255, (d[j + c] - lo) * k));
  }
}

/** JPEG abaixo do limite (meta < 1 MB por página): reduz a qualidade e, se preciso, o tamanho. */
export async function paraJpeg(c: HTMLCanvasElement, maxBytes = 1_000_000): Promise<{ blob: Blob; largura: number; altura: number }> {
  let atual = c;
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    for (const q of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await new Promise<Blob | null>((r) => atual.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= maxBytes) return { blob, largura: atual.width, altura: atual.height };
    }
    const m = document.createElement("canvas");
    m.width = Math.round(atual.width * 0.8); m.height = Math.round(atual.height * 0.8);
    m.getContext("2d")!.drawImage(atual, 0, 0, m.width, m.height);
    atual = m;
  }
  const blob = await new Promise<Blob | null>((r) => atual.toBlob(r, "image/jpeg", 0.5));
  return { blob: blob!, largura: atual.width, altura: atual.height };
}
