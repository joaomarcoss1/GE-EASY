import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { hasServiceRole } from "@/lib/supabase/admin";
import { disconnectGoogle } from "@/lib/google";

export const dynamic = "force-dynamic";

/** Verifica se o POST veio do próprio site (bloqueia CSRF). */
function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>([request.nextUrl.host]);
  const host = request.headers.get("host");
  if (host) allowed.add(host);
  const fwd = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwd) allowed.add(fwd);
  try {
    allowed.add(new URL(env.siteUrl).host);
  } catch {
    /* siteUrl inválida: ignora */
  }
  return allowed.has(originHost);
}

/** Desconecta a conta Google (revoga o token e apaga a integração). Somente POST do mesmo site. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem não permitida" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const target = new URL("/configuracoes?tab=integracoes", request.nextUrl.origin);
  if (hasServiceRole()) {
    try {
      await disconnectGoogle(session.userId);
      target.searchParams.set("ok", "desconectado");
    } catch (e) {
      console.error("[google.disconnect]", e instanceof Error ? e.message : e);
      target.searchParams.set("erro", "desconectar");
    }
  } else target.searchParams.set("erro", "config");
  return NextResponse.redirect(target, 303);
}

export function GET() {
  return new NextResponse("Método não permitido", { status: 405, headers: { Allow: "POST" } });
}
