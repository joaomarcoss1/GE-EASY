import { describe, expect, it } from "vitest";
import { renderModelo, renderTexto } from "../juridico/merge";

const hoje = new Date("2026-10-14T15:00:00Z");

describe("modelos de documentos", () => {
  it("preenche placeholders do cliente, processo e data", () => {
    const { html, faltando } = renderModelo("{{cliente.nome}}, CPF {{cliente.documento}} — {{processo.numero_cnj}} — {{cidade}}, {{data_extenso}}.", {
      cliente: { nome: "Maria Souza", documento: "52998224725", cidade: "Campinas" },
      processo: { numero_cnj: "00000012320268260100" },
      hoje,
    });
    expect(html).toBe("Maria Souza, CPF 529.982.247-25 — nº 0000001-23.2026.8.26.0100 — Campinas, 14 de outubro de 2026.");
    expect(faltando).toEqual([]);
  });
  it("escapa HTML dos valores e do modelo", () => {
    const { html } = renderModelo("<b>{{cliente.nome}}</b>", { cliente: { nome: "<script>x</script>" }, hoje });
    expect(html).toBe("&lt;b&gt;&lt;script&gt;x&lt;/script&gt;&lt;/b&gt;");
  });
  it("destaca placeholders desconhecidos ou vazios", () => {
    const { html, faltando } = renderModelo("OAB {{responsavel.oab}} {{inexistente}}", { hoje });
    expect(faltando).toEqual(["responsavel.oab", "inexistente"]);
    expect(html).toContain('<mark class="ge-missing">[inexistente]</mark>');
  });
  it("gera texto puro", () => {
    expect(renderTexto("Olá {{cliente.nome}}", { cliente: { nome: "João" }, hoje })).toBe("Olá João");
  });
});
