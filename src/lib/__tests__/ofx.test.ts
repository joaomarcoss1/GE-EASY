import { describe, expect, it } from "vitest";
import { lerOfx } from "../financeiro/ofx";

describe("extrato OFX", () => {
  it("lê transações SGML (sem fechamento de tags) e XML", () => {
    const sgml = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261020120000[-3:BRT]
<TRNAMT>1500.00
<FITID>A1
<MEMO>PIX RECEBIDO   CLIENTE
</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261021<TRNAMT>-89,90<FITID>A2<NAME>TARIFA</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(lerOfx(sgml)).toEqual([
      { data: "2026-10-20", valor: 1500, descricao: "PIX RECEBIDO CLIENTE", fitid: "A1" },
      { data: "2026-10-21", valor: -89.9, descricao: "TARIFA", fitid: "A2" },
    ]);
    const xml = `<OFX><STMTTRN><DTPOSTED>20261001</DTPOSTED><TRNAMT>-10.5</TRNAMT><MEMO>Café</MEMO></STMTTRN></OFX>`;
    const [m] = lerOfx(xml);
    expect(m).toMatchObject({ data: "2026-10-01", valor: -10.5, descricao: "Café" });
    expect(m.fitid).toBe(lerOfx(xml)[0].fitid); // chave estável sem FITID
    expect(lerOfx("arquivo qualquer")).toEqual([]);
  });
});
