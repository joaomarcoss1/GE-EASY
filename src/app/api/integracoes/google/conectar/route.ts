import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { googleConfigured } from "@/lib/env";
import { googleAuthUrl } from "@/lib/google";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "ge_oauth_state";

/** Inicia o OAuth do Google (Agenda + Drive) com proteção de CSRF via parâmetro `state`. */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/configuracoes?tab=integracoes")}`);
  if (!session.profile.active) return NextResponse.redirect(`${origin}/acesso-pendente`);
  if (!googleConfigured()) return NextResponse.redirect(`${origin}/configuracoes?tab=integracoes&erro=config`);

  const state = randomBytes(32).toString("base64url");
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/integracoes/google",
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
