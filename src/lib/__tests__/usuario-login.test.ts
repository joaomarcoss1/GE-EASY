import { describe, expect, it } from "vitest";
import { ehEmailTecnico, emailTecnico, normalizarUsuario, sugerirUsuario, USUARIO_RE } from "@/lib/usuario-login";

describe("login por nome de usuário", () => {
  it("normaliza acentos, espaços e símbolos", () => {
    expect(normalizarUsuario(" Vânia  Souza ")).toBe("vania.souza");
    expect(normalizarUsuario("JOSÉ@#1")).toBe("jose1");
    expect(USUARIO_RE.test("vania.souza")).toBe(true);
    expect(USUARIO_RE.test("ab")).toBe(false);
  });
  it("sugere primeiro e último nome", () => {
    expect(sugerirUsuario("Maria das Graças Lima")).toBe("maria.lima");
    expect(sugerirUsuario("Santana")).toBe("santana");
  });
  it("usa e-mail técnico em domínio reservado", () => {
    expect(emailTecnico("jose")).toBe("jose@usuarios.geeasy.invalid");
    expect(ehEmailTecnico("jose@usuarios.geeasy.invalid")).toBe(true);
    expect(ehEmailTecnico("jose@empresa.com.br")).toBe(false);
  });
});
