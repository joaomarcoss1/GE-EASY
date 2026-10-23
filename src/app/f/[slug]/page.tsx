import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, hasServiceRole } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { FormularioLead } from "@/components/leads/formulario-publico";

export const dynamic = "force-dynamic";

type Form = { slug: string; titulo: string; descricao: string | null; interesses: string[]; pedir_documento: boolean; pedir_renda: boolean; empresas: { nome: string; marca: { cor?: string; logo_url?: string } | null } };

async function carregar(slug: string): Promise<Form | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug) || !hasServiceRole()) return null;
  // só campos públicos do formulário e o nome/marca da empresa
  const { data } = await createAdminClient().from("lead_formularios")
    .select("slug, titulo, descricao, interesses, pedir_documento, pedir_renda, empresas(nome, marca)").eq("slug", slug).eq("ativo", true).maybeSingle();
  return (data as unknown as Form) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const f = await carregar((await params).slug);
  return { title: f ? `${f.titulo} — ${f.empresas.nome}` : "Formulário", robots: { index: false } };
}

/** Formulário público de captação de leads (link para campanhas, bio, QR code). */
export default async function FormularioPublicoPage({ params }: { params: Promise<{ slug: string }> }) {
  const f = await carregar((await params).slug);
  if (!f) notFound();
  return (
    <main className="min-h-dvh bg-surface-2 px-4 py-10">
      <div className="card mx-auto max-w-lg p-6 sm:p-8">
        {f.empresas.marca?.logo_url && /^https:\/\//.test(f.empresas.marca.logo_url) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.empresas.marca.logo_url} alt={f.empresas.nome} className="mb-4 h-10 w-auto" />
        )}
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{f.empresas.nome}</p>
        <h1 className="mt-1 text-2xl font-bold">{f.titulo}</h1>
        {f.descricao && <p className="mt-2 text-sm text-muted">{f.descricao}</p>}
        <FormularioLead slug={f.slug} empresa={f.empresas.nome} interesses={f.interesses} pedirDocumento={f.pedir_documento} pedirRenda={f.pedir_renda} turnstileKey={env.turnstileSiteKey} />
      </div>
    </main>
  );
}
