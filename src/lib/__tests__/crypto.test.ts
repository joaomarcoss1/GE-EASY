import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("criptografia AES-256-GCM", () => {
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  it("cifra e decifra, com IV aleatório", async () => {
    const { encrypt, decrypt } = await import("../crypto");
    const a = encrypt("token-secreto");
    const b = encrypt("token-secreto");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("token-secreto");
  });
  it("detecta adulteração", async () => {
    const { encrypt, decrypt } = await import("../crypto");
    const [iv, tag, enc] = encrypt("abc").split(".");
    const tampered = [iv, tag, Buffer.from("xyz").toString("base64url") + enc.slice(4)].join(".");
    expect(() => decrypt(tampered)).toThrow();
  });
});
