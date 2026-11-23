import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  oxc: false,
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"] },
});
