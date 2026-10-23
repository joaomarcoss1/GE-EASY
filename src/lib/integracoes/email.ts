import "server-only";
import { serverEnv } from "@/lib/env";

/** E-mail transacional pela API do Resend. Sem RESEND_API_KEY, não envia (o aviso fica só no sistema). */
export const emailConfigurado = () => Boolean(serverEnv().resendApiKey);

export async function enviarEmail(para: string[], assunto: string, html: string) {
  const { resendApiKey, emailFrom } = serverEnv();
  if (!resendApiKey || !para.length) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: emailFrom, to: para.slice(0, 50), subject: assunto.slice(0, 200), html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
  return true;
}

export const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
