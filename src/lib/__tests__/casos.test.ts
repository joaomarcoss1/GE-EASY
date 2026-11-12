import { describe, expect, it } from "vitest";
import { filtrosNome, lerFiltros, qs, semAcento } from "../casos";

describe("busca de processos", () => {
  it("remove acentos como o banco", () => {
    expect(semAcento("José Conceição São")).toBe("jose conceicao sao");
  });
  it("separa palavras e reconhece CPF", () => {
    expect(filtrosNome("Maria Silva")).toEqual({ dig: null, palavras: ["maria", "silva"] });
    expect(filtrosNome("606.874.253-95")).toEqual({ dig: "60687425395", palavras: [] });
  });
  it("lê e reconstrói os filtros da URL", () => {
    const f = lerFiltros({ corretor: "jose", papel: "principal", habilitado: "sim", exigencia: "cumprida", assinaturas: "faltando", status: "x", ano: "2025" });
    expect(f).toMatchObject({ corretor: "JOSE", principal: true, habilitado: true, exigencia: "cumprida", assinaturas: "faltando", status: null, ano: 2025 });
    expect(qs(f)).toContain("papel=principal");
    expect(qs(f)).toContain("habilitado=sim");
  });
});
