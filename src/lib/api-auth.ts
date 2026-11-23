import "server-only";
import { NextResponse } from "next/server";
import { getSituacao2fa, type Session } from "@/lib/auth";

interface ApiAuthOptions {
  /** APIs da plataforma podem existir sem uma empresa ativa. */
  exigirEmpresa?: boolean;
}

/**
 * Barreira comum para todas as APIs privadas.
 *
 * O middleware não consulta a política de cada empresa nas URLs /api. Por isso,
 * toda rota autenticada deve chamar este guard imediatamente após getSession().
 * O teste api-mfa-coverage impede que uma rota privada nova esqueça esta etapa.
 */
export async function protegerApi(session: Session | null, options: ApiAuthOptions = {}): Promise<NextResponse | null> {
  if (!session) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (session.trocarSenha) return NextResponse.json({ error: "Defina a nova senha antes de continuar." }, { status: 403 });

  const exigirEmpresa = options.exigirEmpresa !== false;
  if (exigirEmpresa && (!session.empresa || !session.profile.active)) {
    return NextResponse.json({ error: "Acesso à empresa indisponível ou revogado." }, { status: 403 });
  }

  const mfa = await getSituacao2fa(session.profile);
  if (mfa.bloqueado) {
    return NextResponse.json(
      {
        error: mfa.verificar
          ? "Conclua a autenticação em dois fatores."
          : "Cadastre a autenticação em dois fatores exigida pela política de segurança.",
      },
      { status: 403 },
    );
  }
  return null;
}
