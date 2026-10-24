import "server-only";
import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { Ponto } from "@/lib/geo";

/**
 * Mapas: geocodificação (endereço → coordenadas) e planejamento de rota.
 * Com GOOGLE_MAPS_API_KEY usa o Google (Geocoding + Directions com otimização de paradas); sem chave,
 * geocodifica pelo OpenStreetMap (Nominatim, baixo volume) e ordena por vizinho mais próximo.
 * A geocodificação tem cache (hash do endereço normalizado → coordenadas) para economizar chamadas.
 */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export async function geocodificar(endereco: string): Promise<(Ponto & { fonte: string }) | null> {
  const texto = normalizar(endereco);
  if (texto.length < 6) return null;
  const chave = createHash("sha256").update(texto).digest("hex");
  const supabase = await createClient();
  const { data: cache } = await supabase.from("geocodificacoes").select("lat, lng, fonte").eq("chave", chave).maybeSingle();
  if (cache) return { lat: Number(cache.lat), lng: Number(cache.lng), fonte: `${cache.fonte} (cache)` };

  const { data: permitido } = await supabase.rpc("rate_limit", { p_acao: "geocodificar", p_max: 120, p_janela_seg: 3600 });
  if (permitido !== true) return null;
  const { googleMapsKey } = serverEnv();
  let p: (Ponto & { fonte: string }) | null = null;
  try {
    if (googleMapsKey) {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("address", endereco);
      u.searchParams.set("region", "br");
      u.searchParams.set("key", googleMapsKey);
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { status: string; results?: { geometry: { location: { lat: number; lng: number } } }[] };
      const loc = j.status === "OK" ? j.results?.[0]?.geometry.location : null;
      if (loc) p = { lat: loc.lat, lng: loc.lng, fonte: "google" };
    } else {
      const u = new URL("https://nominatim.openstreetmap.org/search");
      u.searchParams.set("q", endereco);
      u.searchParams.set("format", "json");
      u.searchParams.set("limit", "1");
      u.searchParams.set("countrycodes", "br");
      const r = await fetch(u, { headers: { "User-Agent": "GE-EASY/1.0 (gestao empresarial)", "Accept-Language": "pt-BR" }, signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { lat: string; lon: string }[];
      if (j[0]) p = { lat: Number(j[0].lat), lng: Number(j[0].lon), fonte: "openstreetmap" };
    }
  } catch (e) {
    console.error("[geocodificar]", e instanceof Error ? e.message : e);
  }
  if (p) await supabase.from("geocodificacoes").upsert({ chave, lat: p.lat, lng: p.lng, fonte: p.fonte }, { onConflict: "empresa_id,chave" });
  return p;
}

interface PlanoGoogle {
  ordem: number[];
  distanciaM: number;
  duracaoS: number;
}

/** Ordem otimizada e distância/tempo rodoviários pelo Google Directions (até 23 paradas). Null sem chave ou em falha. */
export async function planejarComGoogle(origem: Ponto, paradas: Ponto[]): Promise<PlanoGoogle | null> {
  const { googleMapsKey } = serverEnv();
  if (!googleMapsKey || paradas.length < 1 || paradas.length > 23) return null;
  const u = new URL("https://maps.googleapis.com/maps/api/directions/json");
  const fmt = (p: Ponto) => `${p.lat},${p.lng}`;
  u.searchParams.set("origin", fmt(origem));
  u.searchParams.set("destination", fmt(origem));
  u.searchParams.set("waypoints", `optimize:true|${paradas.map(fmt).join("|")}`);
  u.searchParams.set("key", googleMapsKey);
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    const j = (await r.json()) as { status: string; routes?: { waypoint_order: number[]; legs: { distance: { value: number }; duration: { value: number } }[] }[] };
    const rota = j.status === "OK" ? j.routes?.[0] : null;
    if (!rota) return null;
    // sem a volta à origem: a última perna (última parada → origem) não conta
    const pernas = rota.legs.slice(0, -1);
    return { ordem: rota.waypoint_order, distanciaM: pernas.reduce((a, l) => a + l.distance.value, 0), duracaoS: pernas.reduce((a, l) => a + l.duration.value, 0) };
  } catch (e) {
    console.error("[directions]", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Link do Google Maps com o trajeto (origem, até 9 paradas intermediárias e destino). */
export function linkTrajeto(pontos: Ponto[]): string | null {
  if (pontos.length < 2) return pontos[0] ? `https://www.google.com/maps/search/?api=1&query=${pontos[0].lat},${pontos[0].lng}` : null;
  const fmt = (p: Ponto) => `${p.lat},${p.lng}`;
  const meio = pontos.slice(1, -1).slice(0, 9).map(fmt).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${fmt(pontos[0])}&destination=${fmt(pontos[pontos.length - 1])}${meio ? `&waypoints=${encodeURIComponent(meio)}` : ""}&travelmode=driving`;
}
