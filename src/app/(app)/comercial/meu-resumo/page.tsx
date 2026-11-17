import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/rbac";
import { todayISO } from "@/lib/format";
import { addDays } from "@/components/dashboard/periods";
import { PageHeader } from "@/components/ui/page-header";
import { ResumoDiaForm, type ClienteRapido } from "@/components/comercial/resumo-dia-form";
import type { ResumoDiaInput } from "@/lib/actions/resumo-dia";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Meu resumo do dia" };

/** Resumo do dia do consultor/assessor (hoje ou, para corrigir, ontem). */
export default async function MeuResumoPage({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const { profile, userId } = await requireSession();
  if (!can(profile, "clientes.view")) redirect("/inicio?erro=permissao");
  const { dia: diaParam } = await searchParams;
  const hoje = todayISO();
  const ontem = addDays(hoje, -1);
  const dia = diaParam === "ontem" ? ontem : hoje;
  const ini = `${dia}T00:00:00-03:00`;
  const fim = `${addDays(dia, 1)}T00:00:00-03:00`;
  const supabase = await createClient();
  const [{ data: atual }, { count: processos }, { count: ligacoes }, { count: visitas }, { count: documentos }, { data: cli }] = await Promise.all([
    supabase.from("resumos_diarios").select("*").eq("usuario_id", userId).eq("data", dia).maybeSingle(),
    supabase.from("clientes").select("id", { count: "exact", head: true }).eq("consultor_id", userId).gte("created_at", ini).lt("created_at", fim),
    supabase.from("interacoes").select("id", { count: "exact", head: true }).eq("autor_id", userId).eq("tipo", "ligacao").gte("created_at", ini).lt("created_at", fim),
    supabase.from("visitas").select("id", { count: "exact", head: true }).eq("consultor_id", userId).gte("checkin_em", ini).lt("checkin_em", fim),
    supabase.from("documentos").select("id", { count: "exact", head: true }).eq("enviado_por", userId).gte("created_at", ini).lt("created_at", fim),
    supabase.from("clientes").select("id, nome, telefone, whatsapp").order("updated_at", { ascending: false }).limit(400),
  ]);
  const sugestao = { processos: processos ?? 0, ligacoes: ligacoes ?? 0, visitas: visitas ?? 0, documentos: documentos ?? 0 };
  const clientes: ClienteRapido[] = (cli ?? []).map((c) => ({ id: c.id as string, nome: c.nome as string, telefone: (c.whatsapp || c.telefone) as string | null }));
  const r = atual as (ResumoDiaInput & { enviado_em: string }) | null;
  const inicial: ResumoDiaInput = r
    ? {
        data: dia, processos_novos: r.processos_novos, processos_trabalhados: r.processos_trabalhados, ligacoes: r.ligacoes, visitas: r.visitas,
        documentos_coletados: r.documentos_coletados, pendencias_resolvidas: r.pendencias_resolvidas, ligacoes_detalhe: r.ligacoes_detalhe ?? [],
        avaliacao: r.avaliacao ?? null, atividades: r.atividades ?? "", dificuldades: r.dificuldades ?? "", plano_amanha: r.plano_amanha ?? "",
      }
    : {
        data: dia, processos_novos: sugestao.processos, processos_trabalhados: 0, ligacoes: sugestao.ligacoes, visitas: sugestao.visitas,
        documentos_coletados: sugestao.documentos, pendencias_resolvidas: 0, ligacoes_detalhe: [], avaliacao: null, atividades: "", dificuldades: "", plano_amanha: "",
      };
  const aba = "rounded-lg px-3 py-1.5 text-sm font-semibold";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Comercial"
        title="Meu resumo do dia"
        description={`${dia.split("-").reverse().join("/")} · leva menos de 2 minutos. A gestão acompanha em Resumo diário.`}
        actions={
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
            <Link href="/comercial/meu-resumo" className={cn(aba, dia === hoje ? "bg-brand-700 text-white" : "text-muted hover:bg-surface-2")}>Hoje</Link>
            <Link href="/comercial/meu-resumo?dia=ontem" className={cn(aba, dia === ontem ? "bg-brand-700 text-white" : "text-muted hover:bg-surface-2")}>Ontem</Link>
          </div>
        }
      />
      <ResumoDiaForm key={dia} inicial={inicial} clientes={clientes} sugestao={sugestao} data={dia} enviadoEm={r?.enviado_em ?? null} />
    </div>
  );
}
