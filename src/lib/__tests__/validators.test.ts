import { describe, expect, it } from "vitest";
import { isValidCNPJ, isValidCPF, isValidDocumento } from "../validators";

describe("validação de documentos", () => {
  it("aceita CPF válido com ou sem máscara", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("52998224725")).toBe(true);
  });
  it("rejeita CPF inválido e repetido", () => {
    expect(isValidCPF("529.982.247-24")).toBe(false);
    expect(isValidCPF("111.111.111-11")).toBe(false);
    expect(isValidCPF("123")).toBe(false);
  });
  it("aceita CNPJ válido e rejeita inválido", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
    expect(isValidCNPJ("11.222.333/0001-80")).toBe(false);
    expect(isValidCNPJ("00.000.000/0000-00")).toBe(false);
  });
  it("detecta o tipo pelo tamanho", () => {
    expect(isValidDocumento("52998224725")).toBe(true);
    expect(isValidDocumento("11222333000181")).toBe(true);
    expect(isValidDocumento("1234567890")).toBe(false);
  });
});
