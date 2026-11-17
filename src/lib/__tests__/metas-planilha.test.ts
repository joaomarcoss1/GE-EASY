import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ritmoEsperado } from "@/components/metas/metas-processos";
import { aba, gerarPlanilha, paraData } from "@/lib/planilha";

describe("ritmo esperado das metas", () => {
  it("meta diária vale o dia todo", () => {
    expect(ritmoEsperado("diaria", "2026-11-17", "2026-11-17", "2026-11-17")).toBe(100);
  });
  it("meta mensal acompanha os dias do mês", () => {
    expect(Math.round(ritmoEsperado("mensal", "2026-11-01", "2026-11-30", "2026-11-15"))).toBe(50);
    expect(ritmoEsperado("mensal", "2026-11-01", "2026-11-30", "2026-12-02")).toBe(100);
  });
  it("meta anual acompanha os dias do ano", () => {
    expect(Math.round(ritmoEsperado("anual", "2026-01-01", "2026-12-31", "2026-07-02"))).toBe(50);
  });
});

describe("planilha exportada", () => {
  it("converte datas sem deslocar o dia", () => {
    expect(paraData("2026-11-17")?.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(paraData(null)).toBeNull();
    expect(paraData("xx")).toBeNull();
  });
  it("gera um .xlsx válido com resumo e dados", async () => {
    const buf = await gerarPlanilha({
      titulo: "Teste",
      empresa: "Empresa",
      usuario: "Usuário",
      filtros: ["Status: Habilitado"],
      resumo: [{ rotulo: "Total", valor: 2 }],
      abas: [aba<{ nome: string; data: string }>("Dados", [
        { titulo: "Nome", valor: (r) => r.nome },
        { titulo: "Data", valor: (r) => paraData(r.data), formato: "data" },
      ], [{ nome: "=1+1", data: "2026-11-17" }, { nome: "B", data: "2026-11-18" }])],
    });
    // arquivo xlsx = zip ("PK")
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf.length).toBeGreaterThan(5000);
  });
});
