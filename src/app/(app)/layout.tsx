import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/rbac";
import { AppShell } from "@/components/layout/app-shell";
import { SessionGuard } from "@/components/layout/session-guard";

export const dynamic = "force-dynamic";

interface PoliticaSeguranca {
  inatividade_min?: number;
  exigir_2fa?: "nenhum" | "gestao" | "todos";
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession();
  const supabase = await createClient();
  const [{ data: cfg }, { data: aal }] = await Promise.all([
    supabase.from("configuracoes").select("valor").eq("chave", "seguranca").maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  const politica = (cfg?.valor ?? {}) as PoliticaSeguranca;
  const minutos = Math.min(240, Math.max(5, Number(politica.inatividade_min) || 30));

  // 2FA obrigatória (definida pelo administrador): sem fator cadastrado, só a tela de segurança fica liberada
  const exigir = politica.exigir_2fa === "todos" || (politica.exigir_2fa === "gestao" && (isManagerRole(profile.role) || profile.role === "financeiro"));
  if (exigir && aal?.nextLevel !== "aal2") {
    const path = (await headers()).get("x-geeasy-path") ?? "";
    if (!path.startsWith("/configuracoes")) redirect("/configuracoes?tab=seguranca&exigir2fa=1");
  }

  return (
    <AppShell profile={profile}>
      {children}
      <SessionGuard minutos={minutos} />
    </AppShell>
  );
}
