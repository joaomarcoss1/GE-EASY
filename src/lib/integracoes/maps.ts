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

/**
 * Ordem otimizada e distância/tempo rodoviários pela Routes API do Google (computeRoutes com optimizeWaypointOrder,
 * até 25 paradas). A Directions API antiga não pode mais ser ativada em projetos novos. Null sem chave ou em falha.
 */
export async function planejarComGoogle(origem: Ponto, paradas: Ponto[]): Promise<PlanoGoogle | null> {
  const { googleMapsKey } = serverEnv();
  if (!googleMapsKey || paradas.length < 1 || paradas.length > 25) return null;
  const ponto = (p: Ponto) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleMapsKey,
        // só os campos usados: o Google cobra e responde pelo que é pedido
        "X-Goog-FieldMask": "routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration",
      },
      body: JSON.stringify({ origin: ponto(origem), destination: ponto(origem), intermediates: paradas.map(ponto), travelMode: "DRIVE", optimizeWaypointOrder: true, languageCode: "pt-BR", units: "METRIC" }),
      signal: AbortSignal.timeout(10000),
    });
    const j = (await r.json()) as { routes?: { optimizedIntermediateWaypointIndex?: number[]; legs?: { distanceMeters?: number; duration?: string }[] }[]; error?: { message?: string } };
    const rota = r.ok ? j.routes?.[0] : null;
    if (!rota?.legs?.length) {
      if (j.error?.message) console.error("[routes]", j.error.message.slice(0, 200));
      return null;
    }
    // sem a volta à origem: a última perna (última parada → origem) não conta
    const pernas = rota.legs.slice(0, -1);
    return {
      ordem: rota.optimizedIntermediateWaypointIndex ?? paradas.map((_, i) => i),
      distanciaM: pernas.reduce((a, l) => a + (l.distanceMeters ?? 0), 0),
      duracaoS: pernas.reduce((a, l) => a + (parseInt(l.duration ?? "0", 10) || 0), 0),
    };
  } catch (e) {
    console.error("[routes]", e instanceof Error ? e.message : e);
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
