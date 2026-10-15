/**
 * Verificação do conteúdo real dos arquivos enviados (assinatura / "magic bytes").
 * O tipo informado pelo navegador não é confiável: um HTML com script poderia ser
 * enviado como "application/pdf". Só aceitamos quando o início do arquivo confere.
 */
const starts = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // .doc / .xls
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // .docx / .xlsx

function pareceTexto(b: Uint8Array) {
  const amostra = b.subarray(0, 4096);
  let ctrl = 0;
  for (const c of amostra) {
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  if (ctrl > amostra.length * 0.02) return false;
  const txt = new TextDecoder("utf-8", { fatal: false }).decode(amostra).toLowerCase();
  // texto puro não deve trazer marcação ativa (seria interpretado por navegadores)
  return !/<\s*(script|html|iframe|svg|object|embed)\b|javascript:/.test(txt);
}

export function detectarTipoArquivo(b: Uint8Array, mime: string): boolean {
  switch (mime) {
    case "application/pdf":
      return starts(b, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case "image/png":
      return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].slice(0, 4));
    case "image/jpeg":
      return starts(b, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8);
    case "image/heic":
      return starts(b, [0x66, 0x74, 0x79, 0x70], 4); // ....ftyp
    case "application/msword":
    case "application/vnd.ms-excel":
      return starts(b, OLE);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return starts(b, ZIP);
    case "text/plain":
    case "text/csv":
      return pareceTexto(b);
    default:
      return false;
  }
}
