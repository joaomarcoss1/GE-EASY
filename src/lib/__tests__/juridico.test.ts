import { describe, expect, it } from "vitest";
import { cnjCheckDigits, formatCNJ, isValidCNJ, parseCNJ } from "../juridico/cnj";
import { calcularPrazo, feriadosNacionais, isDiaUtil, pascoa } from "../juridico/prazos";

describe("número CNJ", () => {
  it("calcula e valida o dígito verificador", () => {
    const dv = cnjCheckDigits("0000001", "2026", "8", "26", "0100");
    const num = `0000001-${dv}.2026.8.26.0100`;
    expect(isValidCNJ(num)).toBe(true);
    expect(isValidCNJ(num.replace(`-${dv}.`, `-${dv === "00" ? "01" : "00"}.`))).toBe(false);
  });
  it("valida número real conhecido", () => {
    expect(isValidCNJ("1001234-05.2023.8.26.0100")).toBe(isValidCNJ("10012340520238260100"));
  });
  it("formata e interpreta", () => {
    const dv = cnjCheckDigits("1234567", "2025", "5", "02", "0001");
    expect(formatCNJ(`1234567${dv}2025502` + "0001")).toBe(`1234567-${dv}.2025.5.02.0001`);
    expect(parseCNJ(`1234567${dv}202550200 01`.replace(" ", ""))?.tribunal).toBe("TRT2");
    expect(parseCNJ(`0000001${cnjCheckDigits("0000001", "2026", "8", "26", "0100")}2026826` + "0100")?.tribunal).toBe("TJSP");
  });
});

describe("prazos processuais", () => {
  it("calcula a Páscoa e feriados móveis", () => {
    expect(pascoa(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(feriadosNacionais(2026).has("2026-04-03")).toBe(true); // Sexta-feira Santa
    expect(feriadosNacionais(2026).has("2026-02-16")).toBe(true); // Carnaval
  });
  it("conta apenas dias úteis e exclui o dia da publicação", () => {
    // publicação quarta 07/10/2026; 5 dias úteis: 08,09,13(12 é feriado),14,15 → 15/10
    const r = calcularPrazo("2026-10-07", 5);
    expect(r.dataFim).toBe("2026-10-15");
    expect(r.pulados.some((p) => p.data === "2026-10-12")).toBe(true);
  });
  it("prorroga vencimento que cai em fim de semana (dias corridos)", () => {
    // sexta 09/10 + 1 dia corrido = sábado 10/10 → segunda 13/10 (12/10 feriado)
    expect(calcularPrazo("2026-10-09", 1, "corridos").dataFim).toBe("2026-10-13");
  });
  it("suspende no recesso forense", () => {
    const r = calcularPrazo("2026-12-17", 3);
    expect(r.dataFim >= "2027-01-21").toBe(true);
  });
  it("reconhece dia útil", () => {
    expect(isDiaUtil("2026-10-14")).toBe(true);
    expect(isDiaUtil("2026-10-17")).toBe(false);
  });
});
