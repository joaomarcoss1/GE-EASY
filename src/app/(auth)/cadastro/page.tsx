import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { FormCadastro } from "@/components/cadastro/form-cadastro";

export const metadata: Metadata = { title: "Criar conta da empresa" };
export const dynamic = "force-dynamic";

/** Cadastro self-service: cria a empresa em teste de 14 dias e convida o responsável como administrador master. */
export default async function CadastroPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { data: planos } = hasServiceRole()
    ? await createAdminClient().from("planos").select("codigo, nome, descricao, preco_mensal, limites").eq("ativo", true).eq("publico", true).order("ordem")
    : { data: [] };
  return (
    <div className="w-full max-w-lg">
      <h1 className="text-2xl font-bold">Crie a conta da sua empresa</h1>
      <p className="mt-1 text-sm text-muted">14 dias grátis, sem cartão. Você recebe um e-mail para definir a senha.</p>
      <FormCadastro planos={(planos ?? []) as { codigo: string; nome: string; descricao: string | null; preco_mensal: number; limites: { max_usuarios?: number } }[]}
        planoInicial={sp.plano} turnstileKey={env.turnstileSiteKey} raiz={env.rootDomain} />
      <p className="mt-6 text-center text-sm text-muted">Já tem acesso? <Link href="/login" className="font-semibold text-brand-600">Entrar</Link></p>
    </div>
  );
}
