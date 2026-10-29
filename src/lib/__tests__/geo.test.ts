import { describe, expect, it } from "vitest";
import { coordValida, custoPercurso, distanciaM, kmEstimado, ordemVizinhoMaisProximo, percursoM } from "../geo";

const saoLuis = { lat: -2.5307, lng: -44.3068 };
const codo = { lat: -4.4553, lng: -43.8856 };

describe("geo", () => {
  it("distância haversine", () => {
    expect(distanciaM(saoLuis, saoLuis)).toBe(0);
    // São Luís → Codó ≈ 219 km em linha reta
    expect(distanciaM(saoLuis, codo) / 1000).toBeGreaterThan(210);
    expect(distanciaM(saoLuis, codo) / 1000).toBeLessThan(230);
    // ~500 m para o norte
    expect(Math.round(distanciaM(saoLuis, { lat: saoLuis.lat + 0.0045, lng: saoLuis.lng }))).toBeGreaterThan(495);
  });
  it("coordenadas inválidas", () => {
    expect(coordValida({ lat: 0, lng: 0 })).toBe(false);
    expect(coordValida({ lat: 91, lng: 1 })).toBe(false);
    expect(coordValida(null)).toBe(false);
    expect(coordValida(saoLuis)).toBe(true);
  });
  it("ordem por vizinho mais próximo e paradas sem coordenada no fim", () => {
    const perto = { lat: saoLuis.lat + 0.01, lng: saoLuis.lng };
    const longe = { lat: saoLuis.lat + 0.1, lng: saoLuis.lng };
    expect(ordemVizinhoMaisProximo(saoLuis, [longe, null, perto])).toEqual([2, 0, 1]);
    expect(percursoM([saoLuis, perto, longe])).toBeCloseTo(distanciaM(saoLuis, longe), -1);
  });
  it("km estimado e combustível", () => {
    const km = kmEstimado([saoLuis, codo, { lat: 0, lng: 0 }], 1.3);
    expect(km).toBeGreaterThan(273);
    expect(km).toBeLessThan(299);
    expect(custoPercurso(100, { consumoKmL: 10, precoCombustivel: 6, valorKm: 0.9, modo: "consumo" })).toEqual({ litros: 10, combustivel: 60, reembolso: 60 });
    expect(custoPercurso(100, { consumoKmL: 10, precoCombustivel: 6, valorKm: 0.9, modo: "km" }).reembolso).toBe(90);
    expect(custoPercurso(0, { consumoKmL: 0, precoCombustivel: 6, valorKm: 0.9, modo: "km" }).litros).toBe(0);
  });
});
