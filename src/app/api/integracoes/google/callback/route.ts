import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { googleConfigured } from "@/lib/env";
import { exchangeCode, saveTokens } from "@/lib/google";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "ge_oauth_state";
const COOKIE_PATH = "/api/integracoes/google";

function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Retorno do OAuth do Google: valida o `state`, troca o código e grava os tokens criptografados. */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const back = (q: string) => {
    const res = NextResponse.redirect(`${origin}/configuracoes?tab=integracoes&${q}`);
    res.cookies.set(STATE_COOKIE, "", { path: COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: "lax" });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const session = await getSession();
  if (!session) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/configuracoes?tab=integracoes")}`);
  if (!session.profile.active) return NextResponse.redirect(`${origin}/acesso-pendente`);
  if (!googleConfigured()) return back("erro=config");

  if (!sameState(searchParams.get("state"), request.cookies.get(STATE_COOKIE)?.value)) return back("erro=google");
  const code = searchParams.get("code");
  if (searchParams.get("error") || !code || code.length > 2048) return back("erro=google");

  try {
    const tokens = await exchangeCode(code);
    await saveTokens(session.userId, tokens);
  } catch (e) {
    console.error("[google.callback]", e instanceof Error ? e.message : e);
    return back("erro=google");
  }
  return back("ok=google");
}
