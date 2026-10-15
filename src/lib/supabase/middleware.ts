import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha", "/auth", "/acesso-pendente", "/privacidade", "/.well-known"];

export async function updateSession(request: NextRequest) {
  // Rotina agendada: autenticada pelo segredo CRON_SECRET dentro da própria rota (sem sessão)
  if (request.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();
  // Caminho atual para o layout (ex.: exigir 2FA sem bloquear a tela de segurança)
  request.headers.set("x-geeasy-path", request.nextUrl.pathname);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() valida o JWT no servidor de autenticação (não confia só no cookie)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const isApi = path.startsWith("/api/");

  if (!user && !isPublic) {
    if (isApi) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    return NextResponse.redirect(url);
  }

  if (user && !isPublic && !isApi && path !== "/mfa") {
    // Se o usuário tem 2FA ativado, exige nível AAL2 na sessão
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const url = request.nextUrl.clone();
      url.pathname = "/mfa";
      url.search = `?next=${encodeURIComponent(path)}`;
      return NextResponse.redirect(url);
    }
  }

  if (user && (path === "/login" || path === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
