import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AREA_COOKIE, EMPRESA_COOKIE, alvoDoHost, areaDoCaminho } from "@/lib/tenant";

const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha", "/auth", "/acesso-pendente", "/privacidade", "/.well-known", "/empresa-nao-encontrada", "/f", "/cadastro"];
/** Webhooks (assinatura verificada na rota) e endpoints públicos (limite por IP + anti-robô) não usam sessão. */
const SEM_SESSAO = ["/api/cron/", "/api/webhooks/", "/api/publico/"];
const COOKIE_OPTS = { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 180 };

const hostPrincipal = () => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").host.toLowerCase();
  } catch {
    return "";
  }
};

export async function updateSession(request: NextRequest) {
  // Rotina agendada (CRON_SECRET), webhooks e endpoints públicos: autenticados dentro da própria rota
  if (SEM_SESSAO.some((p) => request.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  // Caminho atual para o layout (ex.: exigir 2FA sem bloquear a tela de segurança)
  request.headers.set("x-geeasy-path", request.nextUrl.pathname + request.nextUrl.search);
  const path = request.nextUrl.pathname;

  let response: NextResponse | undefined;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response!.cookies.set(name, value, options));
      },
    },
  });

  // Empresa pelo endereço (<slug>.dominio-raiz ou domínio próprio) e área pelo caminho (/consultor, /rh...).
  // Gravados na requisição (valem já agora) e devolvidos como cookie.
  const definir: { name: string; value: string }[] = [];
  const alvo = alvoDoHost(request.headers.get("host"), process.env.NEXT_PUBLIC_ROOT_DOMAIN, [hostPrincipal()]);
  if (alvo) {
    const { data } = await supabase.rpc("empresa_publica", { p_slug: alvo.slug ?? null, p_dominio: alvo.dominio ?? null });
    const empresa = (data as { id: string }[] | null)?.[0];
    if (!empresa) {
      if (path === "/empresa-nao-encontrada") return NextResponse.next();
      const url = request.nextUrl.clone();
      url.pathname = "/empresa-nao-encontrada";
      url.search = "";
      return NextResponse.rewrite(url);
    }
    if (request.cookies.get(EMPRESA_COOKIE)?.value !== empresa.id) definir.push({ name: EMPRESA_COOKIE, value: empresa.id });
  }
  const area = areaDoCaminho(path);
  if (area && request.cookies.get(AREA_COOKIE)?.value !== area) definir.push({ name: AREA_COOKIE, value: area });
  definir.forEach((c) => request.cookies.set(c.name, c.value));
  response = NextResponse.next({ request });

  const aplicar = (res: NextResponse) => {
    definir.forEach((c) => res.cookies.set(c.name, c.value, COOKIE_OPTS));
    return res;
  };

  // getClaims() renova a sessão se preciso e confere a assinatura do JWT localmente (chaves JWKS),
  // sem uma ida ao servidor de autenticação a cada requisição
  const { data: auth } = await supabase.auth.getClaims();
  const user = auth?.claims?.sub ? auth.claims : null;

  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const isApi = path.startsWith("/api/");

  if (!user && !isPublic) {
    if (isApi) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    return aplicar(NextResponse.redirect(url));
  }

  if (user && !isPublic && !isApi && path !== "/mfa") {
    // Se o usuário tem 2FA ativado, exige nível AAL2 na sessão
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/mfa";
      url.search = `?next=${encodeURIComponent(path)}`;
      return aplicar(NextResponse.redirect(url));
    }
  }

  if (user && (path === "/login" || path === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/inicio";
    url.search = "";
    return aplicar(NextResponse.redirect(url));
  }

  return aplicar(response);
}
