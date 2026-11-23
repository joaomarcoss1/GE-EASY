import { redirect } from "next/navigation";
import { MfaManager } from "@/components/configuracoes/mfa-manager";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Matrícula obrigatória de MFA para o proprietário da plataforma sem empresa ativa. */
export default async function CadastrarMfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.plataformaAdmin) redirect("/inicio?erro=permissao");

  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2") redirect(aal.currentLevel === "aal2" ? "/plataforma" : "/mfa?next=/plataforma");

  return (
    <div className="w-full max-w-2xl">
      <h2 className="text-2xl font-bold tracking-tight">Proteja a conta da plataforma</h2>
      <p className="mb-7 mt-1.5 text-sm text-muted">
        O segundo fator é obrigatório para administrar empresas e acessos da plataforma.
      </p>
      <MfaManager />
    </div>
  );
}
