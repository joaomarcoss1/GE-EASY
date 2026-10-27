import { afterEach, describe, expect, it, vi } from "vitest";

/** Planejamento de rota pela Routes API do Google (fetch simulado). */
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
let chave = "chave-ficticia";
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ googleMapsKey: chave }) }));

const { planejarComGoogle } = await import("@/lib/integracoes/maps");
const origem = { lat: -3.72, lng: -38.52 };
const paradas = [{ lat: -3.73, lng: -38.53 }, { lat: -3.74, lng: -38.5 }];

describe("planejarComGoogle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    chave = "chave-ficticia";
  });

  it("pede a ordem otimizada e soma as pernas sem a volta à origem", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: [1, 0], legs: [{ distanceMeters: 1000, duration: "120s" }, { distanceMeters: 2000, duration: "240s" }, { distanceMeters: 9000, duration: "900s" }] }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await planejarComGoogle(origem, paradas);
    expect(r).toEqual({ ordem: [1, 0], distanciaM: 3000, duracaoS: 360 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://routes.googleapis.com/directions/v2:computeRoutes");
    const corpo = JSON.parse(String(init.body));
    expect(corpo.optimizeWaypointOrder).toBe(true);
    expect(corpo.intermediates).toHaveLength(2);
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("chave-ficticia");
  });

  it("devolve null sem chave, com paradas demais ou em erro do Google", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await planejarComGoogle(origem, paradas)).toBeNull();
    expect(await planejarComGoogle(origem, Array.from({ length: 26 }, () => paradas[0]))).toBeNull();
    chave = "";
    expect(await planejarComGoogle(origem, paradas)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
