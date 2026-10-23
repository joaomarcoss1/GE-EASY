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
  it("as chaves de FUNCIONALIDADES são as mesmas das migrações", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "supabase/migrations");
    const chaves: string[] = [];
    for (const arq of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(dir, arq), "utf8");
      let i = sql.indexOf("insert into public.funcionalidades (");
      while (i >= 0) {
        const fim = sql.indexOf(";", i);
        chaves.push(...[...sql.slice(i, fim).matchAll(/\('([a-z_.]+)', '/g)].map((m) => m[1]));
        i = sql.indexOf("insert into public.funcionalidades (", fim);
      }
    }
    expect(chaves.sort()).toEqual([...FUNCIONALIDADES].sort());
  });
});
