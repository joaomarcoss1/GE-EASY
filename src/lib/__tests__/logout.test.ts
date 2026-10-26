import { beforeEach, describe, expect, it, vi } from "vitest";

/** Sair sempre encerra a sessão deste aparelho, mesmo quando a API de autenticação falha. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [...jar].map(([name, value]) => ({ name, value })), delete: (n: string) => jar.delete(n) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT " + url);
  },
}));
const signOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async () => ({ error: null }), auth: { signOut } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ hasServiceRole: () => false, createAdminClient: () => ({}) }));

const { signOut: sair } = await import("@/lib/actions/auth");

describe("signOut", () => {
  beforeEach(() => {
    jar.clear();
    jar.set("sb-proj-auth-token.0", "a");
    jar.set("sb-proj-auth-token.1", "b");
    jar.set("ge-empresa", "x");
    signOut.mockReset();
  });

  it("apaga os cookies de sessão e volta ao login", async () => {
    signOut.mockResolvedValue({ error: null });
    await expect(sair()).rejects.toThrow("REDIRECT /login");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect([...jar.keys()]).toEqual(["ge-empresa"]);
  });

  it("apaga os cookies mesmo se a API de autenticação falhar", async () => {
    signOut.mockRejectedValue(new Error("rede"));
    await expect(sair()).rejects.toThrow("REDIRECT /login");
    expect([...jar.keys()]).toEqual(["ge-empresa"]);
  });
});
