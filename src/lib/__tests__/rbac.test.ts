import { describe, expect, it } from "vitest";
import { can } from "../rbac";

describe("matriz de permissões", () => {
  it("consultor externo não gere usuários nem relatórios", () => {
    expect(can("consultor_externo", "usuarios.manage")).toBe(false);
    expect(can("consultor_externo", "relatorios.view")).toBe(false);
    expect(can("consultor_externo", "visitas.checkin")).toBe(true);
  });
  it("financeiro gere comissões mas não exclui clientes", () => {
    expect(can("financeiro", "comissoes.manage")).toBe(true);
    expect(can("financeiro", "clientes.delete")).toBe(false);
  });
  it("somente admin acessa auditoria", () => {
    expect(can("admin", "auditoria.view")).toBe(true);
    expect(can("gestor", "auditoria.view")).toBe(false);
  });
  it("sem papel não há permissão", () => {
    expect(can(null, "dashboard.view")).toBe(false);
  });
});
