import type { Option } from "@/lib/constants";

/** Resultados possíveis do check-out de uma visita (mover para lib/constants.ts quando possível). */
export const VISITA_RESULTADOS: Option[] = [
  { value: "venda_realizada", label: "Venda realizada", tone: "green" },
  { value: "proposta_enviada", label: "Proposta enviada", tone: "brand" },
  { value: "retornar_depois", label: "Retornar depois", tone: "amber" },
  { value: "sem_interesse", label: "Sem interesse", tone: "slate" },
  { value: "outro", label: "Outro", tone: "violet" },
];

export const VISITA_RESULTADO_VALUES = VISITA_RESULTADOS.map((r) => r.value);

export const mapsLink = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat == null || lng == null ? null : `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;

export function duration(fromIso: string, toIso?: string | null) {
  const ms = Math.max(0, (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime());
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}
