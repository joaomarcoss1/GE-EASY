import { describe, expect, it } from "vitest";
import { FUNCIONALIDADES, can, isPermission } from "../rbac";

describe("permissões por funcionalidade", () => {
  const consultor = { permissoes: ["dashboard.view", "clientes.view", "clientes.write", "visitas.checkin"] };

  it("vale só o que o usuário recebeu", () => {
    expect(can(consultor, "visitas.checkin")).toBe(true);
    expect(can(consultor, "usuarios.manage")).toBe(false);
    expect(can(consultor, "relatorios.view")).toBe(false);
  });
  it("negação por padrão: sem sessão ou sem lista não há permissão", () => {
    expect(can(null, "dashboard.view")).toBe(false);
    expect(can({}, "dashboard.view")).toBe(false);
    expect(can({ permissoes: [] }, "dashboard.view")).toBe(false);
  });
  it("catálogo sem chaves repetidas e no formato do banco", () => {
    expect(new Set(FUNCIONALIDADES).size).toBe(FUNCIONALIDADES.length);
    for (const f of FUNCIONALIDADES) expect(f).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    expect(isPermission("clientes.view")).toBe(true);
    expect(isPermission("clientes.tudo")).toBe(false);
  });
});

describe("catálogo do app = catálogo do banco", () => {
  it("as chaves de FUNCIONALIDADES são as mesmas da migração", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261022000300_acessos_departamentos.sql"), "utf8");
    const bloco = sql.slice(sql.indexOf("insert into public.funcionalidades ("), sql.indexOf("-- Funcionalidades padrão"));
    const chaves = [...bloco.matchAll(/\('([a-z_.]+)', '/g)].map((m) => m[1]).sort();
    expect(chaves).toEqual([...FUNCIONALIDADES].sort());
  });
});
