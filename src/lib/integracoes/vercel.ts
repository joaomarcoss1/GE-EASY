import "server-only";
import { serverEnv } from "@/lib/env";

/** Domínio próprio da empresa no projeto da Vercel (certificado TLS automático após o DNS apontar). */
export const vercelConfigurado = () => Boolean(serverEnv().vercelApiToken && serverEnv().vercelProjectId);

async function vercel<T>(path: string, init?: RequestInit): Promise<T> {
  const { vercelApiToken, vercelProjectId, vercelTeamId } = serverEnv();
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.vercel.com${path.replace(":projeto", encodeURIComponent(vercelProjectId))}${vercelTeamId ? `${sep}teamId=${encodeURIComponent(vercelTeamId)}` : ""}`, {
    ...init,
    headers: { Authorization: `Bearer ${vercelApiToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!r.ok && j.error?.code !== "domain_already_in_use_by_project") throw new Error(`Vercel ${r.status}: ${j.error?.message ?? r.statusText}`.slice(0, 300));
  return j;
}

export type DominioVercel = { name: string; verified: boolean; verification?: { type: string; domain: string; value: string; reason?: string }[] };

export async function adicionarDominio(dominio: string) {
  return vercel<DominioVercel>("/v10/projects/:projeto/domains", { method: "POST", body: JSON.stringify({ name: dominio }) });
}
export async function verificarDominio(dominio: string) {
  await vercel(`/v9/projects/:projeto/domains/${encodeURIComponent(dominio)}/verify`, { method: "POST" }).catch(() => null);
  const d = await vercel<DominioVercel>(`/v9/projects/:projeto/domains/${encodeURIComponent(dominio)}`);
  const cfg = await vercel<{ misconfigured?: boolean }>(`/v6/domains/${encodeURIComponent(dominio)}/config`).catch(() => ({ misconfigured: true }));
  return { ...d, configurado: !cfg.misconfigured };
}
export async function removerDominio(dominio: string) {
  await vercel(`/v9/projects/:projeto/domains/${encodeURIComponent(dominio)}`, { method: "DELETE" }).catch(() => null);
}
