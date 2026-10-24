/**
 * Leitor de extrato OFX (SGML 1.x ou XML 2.x). Extrai só as transações (STMTTRN): data, valor com sinal,
 * descrição e FITID (identificador único do banco, usado para não importar duas vezes).
 */
type MovimentoOfx = { data: string; valor: number; descricao: string; fitid: string };

const campo = (bloco: string, tag: string) => {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(bloco);
  return m ? m[1].trim() : null;
};

export function lerOfx(texto: string): MovimentoOfx[] {
  const out: MovimentoOfx[] = [];
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  for (const b of blocos) {
    const bloco = b.split(/<\/STMTTRN>/i)[0];
    const dt = campo(bloco, "DTPOSTED");
    const valorTxt = campo(bloco, "TRNAMT");
    if (!dt || !valorTxt || !/^\d{8}/.test(dt)) continue;
    const valor = Math.round(Number(valorTxt.replace(",", ".")) * 100) / 100;
    if (!Number.isFinite(valor) || valor === 0) continue;
    const data = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const descricao = (campo(bloco, "MEMO") ?? campo(bloco, "NAME") ?? "").replace(/\s+/g, " ").slice(0, 300);
    // sem FITID: chave estável a partir dos dados (o mesmo arquivo reimportado gera a mesma chave)
    const fitid = (campo(bloco, "FITID") ?? `${data}|${valor}|${descricao}`).slice(0, 120);
    out.push({ data, valor, descricao, fitid });
  }
  return out;
}
