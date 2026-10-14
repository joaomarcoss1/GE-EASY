const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const numFmt = new Intl.NumberFormat("pt-BR");
const TZ = "America/Sao_Paulo";

export const brl = (v: number | string | null | undefined) => brlFmt.format(Number(v ?? 0));
export const brlShort = (v: number | string | null | undefined) => brlCompact.format(Number(v ?? 0));
export const num = (v: number | null | undefined) => numFmt.format(Number(v ?? 0));
export const pct = (v: number | string | null | undefined, digits = 1) =>
  `${Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: digits })}%`;

/** Datas "puras" (YYYY-MM-DD) não sofrem conversão de fuso */
export function date(v: string | null | undefined) {
  if (!v) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Date(v).toLocaleDateString("pt-BR", { timeZone: TZ });
}

export function dateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function time(v: string | null | undefined) {
  if (!v) return "";
  return new Date(v).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export function relative(v: string) {
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `há ${Math.floor(diff / 86400)} d`;
  return date(v);
}

/** Hoje no fuso de Brasília, formato YYYY-MM-DD */
export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function daysUntil(isoDate: string) {
  const today = new Date(todayISO() + "T00:00:00Z").getTime();
  const target = new Date(isoDate.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((target - today) / 86400000);
}

export const onlyDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export function maskDocumento(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v ?? "";
}

export function maskPhone(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return v ?? "";
}

export function whatsappLink(v: string | null | undefined, text?: string) {
  let d = onlyDigits(v);
  if (!d) return null;
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function initials(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
};
