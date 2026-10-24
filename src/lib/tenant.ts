import type { Area } from "./types";

/**
 * Multiempresa: a empresa ativa vai ao banco no cabeçalho x-empresa-id (o banco confere o vínculo do
 * usuário — um id forjado não abre nada). A área ativa (entrada por departamento) só organiza a interface
 * e vai como x-geeasy-area para a auditoria.
 */
export const EMPRESA_COOKIE = "ge_empresa";
export const AREA_COOKIE = "ge_area";
const AREAS_VALIDAS: readonly Area[] = ["consultor", "administrativo", "juridico", "rh", "financeiro"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isEmpresaId = (v: string | null | undefined): v is string => !!v && UUID.test(v);
export const isArea = (v: string | null | undefined): v is Area => !!v && (AREAS_VALIDAS as readonly string[]).includes(v);

/** Valor seguro para cabeçalho HTTP (ASCII imprimível, tamanho limitado). */
const limpo = (v: string | null | undefined, max: number) => (v ?? "").replace(/[^\x20-\x7e]/g, "").slice(0, max);

/** Cabeçalhos enviados ao Supabase a cada requisição do servidor. */
export function cabecalhosBanco(
  empresa: string | undefined,
  area: string | undefined,
  req?: { get(name: string): string | null },
  /** Origem da auditoria (web | app) e identificação extra (ex.: aparelho do app de campo) */
  contexto?: { origem?: "web" | "app"; requestId?: string },
) {
  const h: Record<string, string> = { "x-geeasy-origem": contexto?.origem ?? "web" };
  if (isEmpresaId(empresa)) h["x-empresa-id"] = empresa;
  if (isArea(area)) h["x-geeasy-area"] = area;
  if (req) {
    const ip = limpo(req.get("x-forwarded-for")?.split(",")[0]?.trim() || req.get("x-real-ip"), 64);
    const ua = limpo(req.get("user-agent"), 300);
    const rid = limpo(req.get("x-vercel-id"), 100);
    if (ip) h["x-geeasy-ip"] = ip;
    if (ua) h["x-geeasy-ua"] = ua;
    if (rid) h["x-geeasy-request-id"] = rid;
  }
  const extra = limpo(contexto?.requestId, 100);
  if (extra) h["x-geeasy-request-id"] = extra;
  return h;
}

/** Área a partir do caminho (as URLs de entrada de cada departamento). */
export function areaDoCaminho(path: string): Area | null {
  const p = path.split("/")[1] ?? "";
  return isArea(p) ? p : null;
}

/**
 * Empresa pelo endereço: <slug>.<NEXT_PUBLIC_ROOT_DOMAIN> ou domínio próprio. Retorna null quando o
 * endereço é o principal (escolha da empresa após o login).
 */
export function alvoDoHost(host: string | null, raiz: string | undefined, principais: string[]): { slug?: string; dominio?: string } | null {
  const h = (host ?? "").toLowerCase().split(":")[0];
  if (!h || principais.includes(h) || h === "localhost" || h.endsWith(".vercel.app")) return null;
  const r = (raiz ?? "").toLowerCase();
  if (r && h === r) return null;
  if (r && h.endsWith(`.${r}`)) {
    const slug = h.slice(0, -(r.length + 1));
    return /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(slug) && slug !== "www" ? { slug } : null;
  }
  return r ? { dominio: h } : null;
}
