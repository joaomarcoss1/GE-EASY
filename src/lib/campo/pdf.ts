/**
 * PDF multipágina a partir de JPEGs (scanner do app). Escrito à mão para não carregar biblioteca no celular:
 * cada página é uma imagem DCT (o próprio JPEG) ajustada à largura A4.
 */
interface PaginaJpeg {
  jpeg: Uint8Array;
  largura: number;
  altura: number;
}

const enc = new TextEncoder();

export function montarPdf(paginas: PaginaJpeg[]): Uint8Array {
  if (!paginas.length) throw new Error("Nenhuma página");
  const partes: Uint8Array[] = [];
  const offsets: number[] = [];
  let tamanho = 0;
  const escrever = (p: Uint8Array | string) => {
    const b = typeof p === "string" ? enc.encode(p) : p;
    partes.push(b);
    tamanho += b.length;
  };
  const objeto = (n: number, corpo: (string | Uint8Array)[]) => {
    offsets[n] = tamanho;
    escrever(`${n} 0 obj\n`);
    corpo.forEach(escrever);
    escrever("\nendobj\n");
  };

  escrever("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const n = paginas.length;
  // 1 = catálogo, 2 = páginas; para cada página i: 3+3i página, 4+3i conteúdo, 5+3i imagem
  objeto(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  objeto(2, [`<< /Type /Pages /Count ${n} /Kids [${paginas.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] >>`]);
  paginas.forEach((p, i) => {
    const largura = 595.28; // A4 em pontos
    const altura = Math.round((largura * p.altura) / p.largura * 100) / 100;
    const conteudo = `q ${largura} 0 0 ${altura} 0 0 cm /Im${i} Do Q`;
    objeto(3 + 3 * i, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largura} ${altura}] /Resources << /XObject << /Im${i} ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`]);
    objeto(4 + 3 * i, [`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`]);
    objeto(5 + 3 * i, [
      `<< /Type /XObject /Subtype /Image /Width ${p.largura} /Height ${p.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      "\nendstream",
    ]);
  });
  const total = 3 + 3 * n;
  const xref = tamanho;
  escrever(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) escrever(`${String(offsets[k]).padStart(10, "0")} 00000 n \n`);
  escrever(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const saida = new Uint8Array(tamanho);
  let pos = 0;
  for (const b of partes) { saida.set(b, pos); pos += b.length; }
  return saida;
}
