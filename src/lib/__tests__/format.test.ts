import { describe, expect, it } from "vitest";
import { brl, date, initials, maskDocumento, maskPhone, onlyDigits, whatsappLink } from "../format";

describe("formatação pt-BR", () => {
  it("formata moeda", () => {
    expect(brl(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(brl(null).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
  it("formata datas puras sem deslocamento de fuso", () => {
    expect(date("2026-10-01")).toBe("01/10/2026");
    expect(date(null)).toBe("—");
  });
  it("aplica máscaras", () => {
    expect(maskDocumento("52998224725")).toBe("529.982.247-25");
    expect(maskDocumento("11222333000181")).toBe("11.222.333/0001-81");
    expect(maskPhone("11987654321")).toBe("(11) 98765-4321");
    expect(onlyDigits("(11) 9.8765-4321")).toBe("11987654321");
  });
  it("gera link de WhatsApp com DDI", () => {
    expect(whatsappLink("11987654321")).toBe("https://wa.me/5511987654321");
    expect(whatsappLink("")).toBeNull();
  });
  it("gera iniciais", () => {
    expect(initials("Maria da Silva")).toBe("MS");
    expect(initials("")).toBe("?");
  });
});
