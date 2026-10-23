import { describe, expect, it } from "vitest";
import { aplicar, avaliarQualidade, detectarDocumento, homografia, limiarOtsu, tamanhoSaida, tonsDeCinza, varianciaLaplaciano, type Quad } from "../campo/visao";
import { montarPdf } from "../campo/pdf";

/** Imagem sintética: fundo escuro com um "documento" claro e texturizado. */
function cena(w: number, h: number, x0: number, y0: number, x1: number, y1: number, borrado = false) {
  const g = new Uint8Array(w * h).fill(30);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = borrado ? 200 : (x + y) % 7 === 0 ? 120 : 220;
  return g;
}

describe("scanner — visão", () => {
  it("tons de cinza e limiar de Otsu separam fundo e documento", () => {
    expect(Array.from(tonsDeCinza(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1))).toEqual([255, 0]);
    const g = cena(100, 100, 20, 20, 80, 80);
    const t = limiarOtsu(g);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it("detecta os quatro cantos do documento", () => {
    const g = cena(120, 100, 20, 10, 100, 90);
    const q = detectarDocumento(g, 120, 100)!;
    expect(q).not.toBeNull();
    const perto = (c: { x: number; y: number }, x: number, y: number) => Math.abs(c.x - x) <= 3 && Math.abs(c.y - y) <= 3;
    expect(perto(q[0], 20, 10)).toBe(true);
    expect(perto(q[1], 99, 10)).toBe(true);
    expect(perto(q[2], 99, 89)).toBe(true);
    expect(perto(q[3], 20, 89)).toBe(true);
    expect(detectarDocumento(new Uint8Array(100).fill(30), 10, 10)).toBeNull();
  });

  it("homografia endireita a perspectiva", () => {
    const de: Quad = [{ x: 10, y: 5 }, { x: 90, y: 15 }, { x: 95, y: 95 }, { x: 5, y: 85 }];
    const para: Quad = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 100 }, { x: 0, y: 100 }];
    const H = homografia(de, para);
    for (let i = 0; i < 4; i++) {
      const p = aplicar(H, de[i]);
      expect(p.x).toBeCloseTo(para[i].x, 6);
      expect(p.y).toBeCloseTo(para[i].y, 6);
    }
    expect(tamanhoSaida(para)).toEqual({ w: 80, h: 100 });
  });

  it("qualidade: foco, documento cortado e foto escura", () => {
    const nitido = cena(100, 100, 10, 10, 90, 90);
    const borrado = cena(100, 100, 10, 10, 90, 90, true);
    expect(varianciaLaplaciano(nitido, 100, 100)).toBeGreaterThan(varianciaLaplaciano(borrado, 100, 100));
    expect(avaliarQualidade(nitido, 100, 100, detectarDocumento(nitido, 100, 100)).ok).toBe(true);
    const cortado = cena(100, 100, 0, 0, 90, 90);
    expect(avaliarQualidade(cortado, 100, 100, detectarDocumento(cortado, 100, 100)).problemas.join(" ")).toMatch(/cortado/);
    expect(avaliarQualidade(new Uint8Array(10000).fill(20), 100, 100, null).problemas.join(" ")).toMatch(/escura/);
  });
});

describe("scanner — PDF", () => {
  it("monta PDF multipágina com xref válida", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const pdf = montarPdf([{ jpeg, largura: 800, altura: 1100 }, { jpeg, largura: 1100, altura: 800 }]);
    const txt = new TextDecoder("latin1").decode(pdf);
    expect(txt.startsWith("%PDF-1.4")).toBe(true);
    expect(txt).toContain("/Count 2");
    expect(txt.trimEnd().endsWith("%%EOF")).toBe(true);
    // a tabela xref aponta para o início de cada objeto
    const startxref = Number(txt.match(/startxref\n(\d+)/)![1]);
    expect(txt.slice(startxref, startxref + 4)).toBe("xref");
    const offs = [...txt.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offs.forEach((o, i) => expect(txt.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(() => montarPdf([])).toThrow();
  });
});

describe("OCR — leitura dos campos", async () => {
  const { extrairDados } = await import("../campo/ocr");
  it("lê CPF válido, nome, nascimento e RG de um RG", () => {
    const texto = "REPÚBLICA FEDERATIVA DO BRASIL\nREGISTRO GERAL 12.345.678-9\nNOME\nMARIA DA SILVA SANTOS\nDATA DE NASCIMENTO 05/03/1985\nDATA DE EXPEDIÇÃO 10/01/2020\nCPF 529.982.247-25";
    const d = extrairDados(texto);
    expect(d.cpf).toBe("52998224725");
    expect(d.nome).toBe("MARIA DA SILVA SANTOS");
    expect(d.data_nascimento).toBe("1985-03-05");
    expect(d.rg).toBe("12345678-9");
  });
  it("ignora CPF inválido e datas implausíveis", () => {
    const d = extrairDados("CPF 111.111.111-11\nVALIDADE 01/01/2031");
    expect(d.cpf).toBeNull();
    expect(d.data_nascimento).toBeNull();
    expect(d.nome).toBeNull();
  });
});
