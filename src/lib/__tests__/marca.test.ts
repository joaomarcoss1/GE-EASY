import { describe, expect, it } from "vitest";
import { cssMarca, paleta } from "../marca";

describe("paleta da marca", () => {
  it("mantém a cor no 500 e clareia/escurece nos extremos", () => {
    const p = paleta("#1E40AF");
    expect(p[500]).toBe("30 64 175");
    expect(Number(p[50].split(" ")[0])).toBeGreaterThan(230);
    expect(Number(p[950].split(" ")[2])).toBeLessThan(60);
  });
  it("ignora valores que não são cor (sem injeção de CSS)", () => {
    expect(cssMarca("red;}body{display:none")).toBe("");
    expect(cssMarca("#00ff00")).toContain("--brand-500:0 255 0;");
  });
});
