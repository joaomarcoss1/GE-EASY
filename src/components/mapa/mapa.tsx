"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { coordValida, type Ponto } from "@/lib/geo";
import { cn } from "@/lib/cn";

export type TomMapa = "brand" | "accent" | "green" | "amber" | "red" | "slate";
const COR: Record<TomMapa, string> = { brand: "#2D2D83", accent: "#E14F26", green: "#059669", amber: "#d97706", red: "#dc2626", slate: "#64748b" };

export interface Marcador extends Ponto {
  rotulo?: string | number;
  titulo?: string;
  tom?: TomMapa;
  pequeno?: boolean;
}
export interface Linha {
  pontos: Ponto[];
  tom?: TomMapa;
  tracejada?: boolean;
}

const BRASIL: Ponto = { lat: -14.2, lng: -51.9 };

/** Ícone redondo com rótulo; o texto entra por textContent (nomes de clientes nunca viram HTML). */
function icone(L: typeof Leaflet, m: { rotulo?: string | number; tom?: TomMapa; pequeno?: boolean }, arrastavel = false) {
  const t = m.pequeno ? 14 : 28;
  const el = document.createElement("span");
  el.textContent = m.rotulo == null ? "" : String(m.rotulo);
  el.style.cssText = `display:flex;align-items:center;justify-content:center;width:${t}px;height:${t}px;border-radius:9999px;background:${COR[m.tom ?? "brand"]};color:#fff;font:700 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);${arrastavel ? "cursor:grab;" : ""}`;
  return L.divIcon({ html: el, className: "", iconSize: [t, t], iconAnchor: [t / 2, t / 2] });
}

/**
 * Mapa (OpenStreetMap + Leaflet, sem chave). Mostra marcadores e linhas e, com onSelecionar, vira seletor de
 * local: clique no mapa ou arraste o marcador. `centralizar` move a vista (ex.: após buscar um endereço).
 */
export function Mapa({
  marcadores = [],
  linhas = [],
  selecao,
  onSelecionar,
  centralizar,
  className,
}: {
  marcadores?: Marcador[];
  linhas?: Linha[];
  selecao?: Ponto | null;
  onSelecionar?: (p: Ponto) => void;
  centralizar?: Ponto | null;
  className?: string;
}) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const camadas = useRef<Leaflet.LayerGroup | null>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const aoSelecionar = useRef(onSelecionar);
  aoSelecionar.current = onSelecionar;
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;
    let obs: ResizeObserver | null = null;
    import("leaflet").then((mod) => {
      // o pacote é CommonJS: conforme o empacotador, a API vem em default ou no próprio módulo
      const L = (mod as unknown as { default?: typeof Leaflet }).default ?? mod;
      if (!vivo || !div.current) return;
      lib.current = L;
      const m = L.map(div.current, { zoomControl: true, attributionControl: true }).setView([BRASIL.lat, BRASIL.lng], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => aoSelecionar.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      camadas.current = L.layerGroup().addTo(m);
      mapa.current = m;
      // dentro de painéis que abrem depois (drawer), o tamanho só é conhecido quando aparece
      obs = new ResizeObserver(() => m.invalidateSize());
      obs.observe(div.current);
      setPronto(true);
    }).catch(() => {
      // sem internet e sem o pacote em cache (app de campo offline): fica só o quadro vazio
    });
    return () => {
      vivo = false;
      obs?.disconnect();
      mapa.current?.remove();
      mapa.current = null;
    };
  }, []);

  // assinatura dos dados: a vista só é reenquadrada quando os pontos mudam (não a cada clique de seleção)
  const assinatura = JSON.stringify([marcadores.map((m) => [m.lat, m.lng]), linhas.map((l) => l.pontos.length)]);
  useEffect(() => {
    const L = lib.current;
    const m = mapa.current;
    if (!pronto || !L || !m) return;
    const validos = marcadores.filter(coordValida);
    const todos = [...validos, ...linhas.flatMap((l) => l.pontos.filter(coordValida)), ...(coordValida(selecao) ? [selecao] : [])];
    if (todos.length === 1) m.setView([todos[0].lat, todos[0].lng], 15);
    else if (todos.length > 1) m.fitBounds(L.latLngBounds(todos.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, assinatura]);

  useEffect(() => {
    const L = lib.current;
    const g = camadas.current;
    if (!pronto || !L || !g) return;
    g.clearLayers();
    for (const l of linhas) {
      const pts = l.pontos.filter(coordValida);
      if (pts.length > 1) L.polyline(pts.map((p) => [p.lat, p.lng] as [number, number]), { color: COR[l.tom ?? "brand"], weight: 4, opacity: 0.75, dashArray: l.tracejada ? "8 8" : undefined }).addTo(g);
    }
    for (const mk of marcadores.filter((x) => coordValida(x))) {
      const marker = L.marker([mk.lat, mk.lng], { icon: icone(L, mk), keyboard: false }).addTo(g);
      if (mk.titulo) {
        const t = document.createElement("span");
        t.textContent = mk.titulo;
        marker.bindTooltip(t);
      }
    }
    if (coordValida(selecao)) {
      const sel = L.marker([selecao.lat, selecao.lng], { icon: icone(L, { tom: "accent", rotulo: "•" }, true), draggable: !!aoSelecionar.current }).addTo(g);
      sel.on("dragend", () => {
        const p = sel.getLatLng();
        aoSelecionar.current?.({ lat: p.lat, lng: p.lng });
      });
    }
  }, [pronto, marcadores, linhas, selecao]);

  useEffect(() => {
    if (pronto && coordValida(centralizar)) mapa.current?.setView([centralizar.lat, centralizar.lng], 17);
  }, [pronto, centralizar]);

  return <div ref={div} className={cn("z-0 h-72 w-full overflow-hidden rounded-xl border border-line bg-surface-2", className)} role="application" aria-label="Mapa" />;
}
