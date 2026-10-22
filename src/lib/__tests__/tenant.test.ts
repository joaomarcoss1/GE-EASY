import { describe, expect, it } from "vitest";
import { alvoDoHost, areaDoCaminho, cabecalhosBanco } from "../tenant";

describe("resolução da empresa pelo endereço", () => {
  const principais = ["ge-easy.vercel.app"];
  it("subdomínio do domínio raiz vira slug", () => {
    expect(alvoDoHost("acme.geeasy.com.br", "geeasy.com.br", principais)).toEqual({ slug: "acme" });
    expect(alvoDoHost("ACME.geeasy.com.br:443", "geeasy.com.br", principais)).toEqual({ slug: "acme" });
  });
  it("endereço principal, www e localhost não escolhem empresa", () => {
    expect(alvoDoHost("geeasy.com.br", "geeasy.com.br", principais)).toBeNull();
    expect(alvoDoHost("www.geeasy.com.br", "geeasy.com.br", principais)).toBeNull();
    expect(alvoDoHost("ge-easy.vercel.app", "geeasy.com.br", principais)).toBeNull();
    expect(alvoDoHost("localhost:3000", undefined, principais)).toBeNull();
  });
  it("slug inválido (subdomínio aninhado) é ignorado", () => {
    expect(alvoDoHost("a.b.geeasy.com.br", "geeasy.com.br", principais)).toBeNull();
  });
  it("outro domínio é domínio próprio (só com domínio raiz configurado)", () => {
    expect(alvoDoHost("sistema.escritorio.com.br", "geeasy.com.br", principais)).toEqual({ dominio: "sistema.escritorio.com.br" });
    expect(alvoDoHost("sistema.escritorio.com.br", undefined, principais)).toBeNull();
  });
});

describe("cabeçalhos para o banco", () => {
  it("só envia empresa e área válidas", () => {
    expect(cabecalhosBanco("nao-uuid", "hack")).toEqual({ "x-geeasy-origem": "web" });
    const h = cabecalhosBanco("0b5e0f6a-1d2c-4c3b-9a8e-7f6d5c4b3a21", "juridico");
    expect(h["x-empresa-id"]).toBe("0b5e0f6a-1d2c-4c3b-9a8e-7f6d5c4b3a21");
    expect(h["x-geeasy-area"]).toBe("juridico");
  });
  it("IP e user-agent saneados", () => {
    const req = new Headers({ "x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "Mozilla/5.0 ç" });
    const h = cabecalhosBanco(undefined, undefined, req);
    expect(h["x-geeasy-ip"]).toBe("200.1.2.3");
    expect(h["x-geeasy-ua"]).toBe("Mozilla/5.0 ");
  });
  it("área pelo caminho", () => {
    expect(areaDoCaminho("/administrativo/documentacao")).toBe("administrativo");
    expect(areaDoCaminho("/clientes")).toBeNull();
  });
});
