import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const apiRoot = join(process.cwd(), "src", "app", "api");
const publicSegments = new Set(["publico", "webhooks", "cron"]);

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routes(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("proteção das APIs privadas", () => {
  it("exige o guard central de MFA em toda rota privada", () => {
    const semGuard = routes(apiRoot)
      .filter((path) => !relative(apiRoot, path).split(/[\\/]/).some((segment) => publicSegments.has(segment)))
      .filter((path) => !readFileSync(path, "utf8").includes("protegerApi("))
      .map((path) => relative(apiRoot, path));

    expect(semGuard, `Rotas privadas sem protegerApi(): ${semGuard.join(", ")}`).toEqual([]);
  });
});
